const { neon } = require("@neondatabase/serverless");

function toRow(r) {
  return {
    id: Number(r.id),
    sender: r.sender,
    recipient: r.recipient,
    ciphertext: r.ciphertext,
    epoch: r.epoch,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

function toGroupMessage(r) {
  return {
    id: Number(r.id),
    groupId: Number(r.group_id),
    sender: r.sender,
    version: r.version,
    ciphertext: r.ciphertext,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

const groupShape = (r, members, keys) => ({
  id: Number(r.id),
  owner: r.owner,
  version: r.key_version,
  members,
  ...(keys ? { keys } : {}),
});

function createNeonStore(databaseUrl) {
  const sql = neon(databaseUrl);

  return {
    async createNonce(nonce, ttlSeconds) {
      await sql`DELETE FROM nonces WHERE expires_at < now()`;
      await sql`INSERT INTO nonces (nonce, expires_at)
                VALUES (${nonce}, now() + make_interval(secs => ${ttlSeconds}))`;
    },
    async consumeNonce(nonce) {
      const rows = await sql`DELETE FROM nonces
                             WHERE nonce = ${nonce} AND expires_at > now()
                             RETURNING nonce`;
      return rows.length === 1;
    },
    async insertMessage({ sender, recipient, ciphertext, epoch }) {
      const rows = await sql`INSERT INTO messages (sender, recipient, ciphertext, epoch)
                             VALUES (${sender}, ${recipient}, ${ciphertext}, ${epoch})
                             RETURNING id, sender, recipient, ciphertext, epoch, created_at`;
      return toRow(rows[0]);
    },
    async countRecentFrom(sender, seconds) {
      const rows = await sql`SELECT count(*)::int AS n FROM messages
                             WHERE sender = ${sender}
                               AND created_at > now() - make_interval(secs => ${seconds})`;
      return rows[0].n;
    },
    async listThread(a, b, limit, beforeId) {
      const rows = await sql`SELECT id, sender, recipient, ciphertext, epoch, created_at
                             FROM messages
                             WHERE LEAST(sender, recipient) = LEAST(${a}::char(42), ${b}::char(42))
                               AND GREATEST(sender, recipient) = GREATEST(${a}::char(42), ${b}::char(42))
                               AND (${beforeId}::bigint IS NULL OR id < ${beforeId}::bigint)
                             ORDER BY id DESC
                             LIMIT ${limit}`;
      return rows.map(toRow);
    },
    async epochPairCounts(epoch) {
      const rows = await sql`SELECT sender, recipient, count(*)::int AS count
                             FROM messages WHERE epoch = ${epoch}
                             GROUP BY sender, recipient`;
      return rows.map((r) => ({ sender: r.sender, recipient: r.recipient, count: r.count }));
    },
    async epochMessages(epoch) {
      const rows = await sql`SELECT m.sender, m.recipient,
                                    extract(epoch FROM m.created_at)::float8 AS ts, f.first_ts
                             FROM messages m
                             JOIN (SELECT sender, min(extract(epoch FROM created_at))::float8 AS first_ts
                                   FROM messages GROUP BY sender) f ON f.sender = m.sender
                             WHERE m.epoch = ${epoch}`;
      return rows.map((r) => ({ sender: r.sender, recipient: r.recipient, ts: r.ts, firstTs: r.first_ts }));
    },
    async createGroup({ owner, keys }) {
      const members = keys.map((k) => k.member);
      const wrapped = keys.map((k) => k.wrapped);
      const rows = await sql`WITH g AS (INSERT INTO groups (owner) VALUES (${owner}) RETURNING id)
                             INSERT INTO group_keys (group_id, version, member, wrapped)
                             SELECT g.id, 1, u.member, u.wrapped
                             FROM g, unnest(${members}::char(42)[], ${wrapped}::text[]) AS u(member, wrapped)
                             RETURNING group_id`;
      return Number(rows[0].group_id);
    },
    async getGroup(id) {
      const rows = await sql`SELECT id, owner, key_version FROM groups WHERE id = ${id}`;
      if (rows.length === 0) return null;
      const members = await sql`SELECT member FROM group_keys WHERE group_id = ${id} AND version = ${rows[0].key_version}`;
      return groupShape(rows[0], members.map((m) => m.member));
    },
    async groupsFor(member) {
      const rows = await sql`SELECT g.id, g.owner, g.key_version FROM groups g
                             JOIN group_keys k ON k.group_id = g.id AND k.version = g.key_version
                             WHERE k.member = ${member} ORDER BY g.id`;
      if (rows.length === 0) return [];
      const ids = rows.map((r) => Number(r.id));
      const everyone = await sql`SELECT k.group_id, k.member FROM group_keys k
                                 JOIN groups g ON g.id = k.group_id AND g.key_version = k.version
                                 WHERE k.group_id = ANY(${ids}::bigint[])`;
      const mine = await sql`SELECT group_id, version, wrapped FROM group_keys
                             WHERE member = ${member} AND group_id = ANY(${ids}::bigint[]) ORDER BY version`;
      return rows.map((r) =>
        groupShape(
          r,
          everyone.filter((m) => Number(m.group_id) === Number(r.id)).map((m) => m.member),
          mine
            .filter((m) => Number(m.group_id) === Number(r.id))
            .map((m) => ({ version: m.version, wrapped: m.wrapped }))
        )
      );
    },
    async addGroupMember(id, version, member, wrapped) {
      const rows = await sql`INSERT INTO group_keys (group_id, version, member, wrapped)
                             SELECT id, key_version, ${member}, ${wrapped} FROM groups
                             WHERE id = ${id} AND key_version = ${version}
                             ON CONFLICT DO NOTHING RETURNING group_id`;
      return rows.length === 1;
    },
    async rekeyGroup(id, oldVersion, keys) {
      const members = keys.map((k) => k.member);
      const wrapped = keys.map((k) => k.wrapped);
      const rows = await sql`WITH bump AS (UPDATE groups SET key_version = ${oldVersion + 1}
                                           WHERE id = ${id} AND key_version = ${oldVersion} RETURNING id)
                             INSERT INTO group_keys (group_id, version, member, wrapped)
                             SELECT bump.id, ${oldVersion + 1}, u.member, u.wrapped
                             FROM bump, unnest(${members}::char(42)[], ${wrapped}::text[]) AS u(member, wrapped)
                             RETURNING group_id`;
      return rows.length > 0;
    },
    // Stored only while the sender holds a key at the group's current version.
    async insertGroupMessage({ groupId, sender, version, ciphertext }) {
      const rows = await sql`INSERT INTO group_messages (group_id, sender, version, ciphertext)
                             SELECT g.id, ${sender}, ${version}, ${ciphertext} FROM groups g
                             JOIN group_keys k ON k.group_id = g.id AND k.version = g.key_version
                             WHERE g.id = ${groupId} AND g.key_version = ${version} AND k.member = ${sender}
                             RETURNING id, group_id, sender, version, ciphertext, created_at`;
      return rows.length === 1 ? toGroupMessage(rows[0]) : null;
    },
    async countRecentGroupFrom(sender, seconds) {
      const rows = await sql`SELECT count(*)::int AS n FROM group_messages
                             WHERE sender = ${sender}
                               AND created_at > now() - make_interval(secs => ${seconds})`;
      return rows[0].n;
    },
    async listGroupMessages(groupId, member, limit, beforeId) {
      const rows = await sql`SELECT m.id, m.group_id, m.sender, m.version, m.ciphertext, m.created_at
                             FROM group_messages m
                             WHERE m.group_id = ${groupId}
                               AND m.version IN (SELECT version FROM group_keys WHERE group_id = ${groupId} AND member = ${member})
                               AND (${beforeId}::bigint IS NULL OR m.id < ${beforeId}::bigint)
                             ORDER BY m.id DESC LIMIT ${limit}`;
      return rows.map(toGroupMessage);
    },
    async ping() {
      await sql`SELECT 1`;
      return true;
    },
    async deleteMessagesInvolving(address) {
      await sql`DELETE FROM messages WHERE sender = ${address} OR recipient = ${address}`;
      await sql`DELETE FROM groups WHERE owner = ${address}`;
      await sql`DELETE FROM group_messages WHERE sender = ${address}`;
      await sql`DELETE FROM group_keys WHERE member = ${address}`;
    },
  };
}

module.exports = { createNeonStore };
