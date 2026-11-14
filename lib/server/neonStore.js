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
    async ping() {
      await sql`SELECT 1`;
      return true;
    },
    async deleteMessagesInvolving(address) {
      await sql`DELETE FROM messages WHERE sender = ${address} OR recipient = ${address}`;
    },
  };
}

module.exports = { createNeonStore };
