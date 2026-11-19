function createMemoryStore(now = () => Date.now()) {
  const nonces = new Map();
  const messages = [];
  let nextId = 1;
  const groups = new Map();
  const groupKeys = [];
  const groupMessages = [];
  let nextGroupId = 1;
  let nextGroupMessageId = 1;

  return {
    async createNonce(nonce, ttlSeconds) {
      nonces.set(nonce, now() + ttlSeconds * 1000);
    },
    async consumeNonce(nonce) {
      const expires = nonces.get(nonce);
      nonces.delete(nonce);
      return expires !== undefined && expires > now();
    },
    async insertMessage({ sender, recipient, ciphertext, epoch }) {
      const row = {
        id: nextId++,
        sender,
        recipient,
        ciphertext,
        epoch,
        createdAt: new Date(now()).toISOString(),
      };
      messages.push(row);
      return row;
    },
    async countRecentFrom(sender, seconds) {
      const since = now() - seconds * 1000;
      return messages.filter(
        (m) => m.sender === sender && Date.parse(m.createdAt) >= since
      ).length;
    },
    async listThread(a, b, limit, beforeId) {
      return messages
        .filter(
          (m) =>
            ((m.sender === a && m.recipient === b) ||
              (m.sender === b && m.recipient === a)) &&
            (beforeId === null || m.id < beforeId)
        )
        .sort((x, y) => y.id - x.id)
        .slice(0, limit);
    },
    async epochPairCounts(epoch) {
      const counts = new Map();
      for (const m of messages) {
        if (m.epoch !== epoch) continue;
        const key = `${m.sender}>${m.recipient}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      return [...counts].map(([key, count]) => {
        const [sender, recipient] = key.split(">");
        return { sender, recipient, count };
      });
    },
    // Metadata only, for the abuse score: sender, recipient, time and the sender's first message ever.
    async epochMessages(epoch) {
      const first = new Map();
      for (const m of messages) first.set(m.sender, Math.min(first.get(m.sender) ?? Infinity, Date.parse(m.createdAt) / 1000));
      return messages
        .filter((m) => m.epoch === epoch)
        .map((m) => ({ sender: m.sender, recipient: m.recipient, ts: Date.parse(m.createdAt) / 1000, firstTs: first.get(m.sender) }));
    },
    // Group chats: members are the people holding a wrapped key at the current version.
    async createGroup({ owner, keys }) {
      const id = nextGroupId++;
      groups.set(id, { id, owner, version: 1 });
      for (const k of keys) groupKeys.push({ groupId: id, version: 1, member: k.member, wrapped: k.wrapped });
      return id;
    },
    async getGroup(id) {
      const g = groups.get(id);
      if (!g) return null;
      const members = groupKeys.filter((k) => k.groupId === id && k.version === g.version).map((k) => k.member);
      return { id, owner: g.owner, version: g.version, members };
    },
    async groupsFor(member) {
      const out = [];
      for (const g of groups.values()) {
        const current = groupKeys.filter((k) => k.groupId === g.id && k.version === g.version);
        if (!current.some((k) => k.member === member)) continue;
        const keys = groupKeys
          .filter((k) => k.groupId === g.id && k.member === member)
          .map((k) => ({ version: k.version, wrapped: k.wrapped }))
          .sort((a, b) => a.version - b.version);
        out.push({ id: g.id, owner: g.owner, version: g.version, members: current.map((k) => k.member), keys });
      }
      return out;
    },
    async addGroupMember(id, version, member, wrapped) {
      const g = groups.get(id);
      if (!g || g.version !== version) return false;
      if (groupKeys.some((k) => k.groupId === id && k.version === version && k.member === member)) return false;
      groupKeys.push({ groupId: id, version, member, wrapped });
      return true;
    },
    // Moves the group to a new key version held only by the listed members.
    async rekeyGroup(id, oldVersion, keys) {
      const g = groups.get(id);
      if (!g || g.version !== oldVersion) return false;
      g.version = oldVersion + 1;
      for (const k of keys) groupKeys.push({ groupId: id, version: g.version, member: k.member, wrapped: k.wrapped });
      return true;
    },
    async insertGroupMessage({ groupId, sender, version, ciphertext }) {
      const g = groups.get(groupId);
      const holds = groupKeys.some((k) => k.groupId === groupId && k.version === version && k.member === sender);
      if (!g || g.version !== version || !holds) return null;
      const row = { id: nextGroupMessageId++, groupId, sender, version, ciphertext, createdAt: new Date(now()).toISOString() };
      groupMessages.push(row);
      return row;
    },
    async countRecentGroupFrom(sender, seconds) {
      const since = now() - seconds * 1000;
      return groupMessages.filter((m) => m.sender === sender && Date.parse(m.createdAt) >= since).length;
    },
    // Only messages under a key version the member holds.
    async listGroupMessages(groupId, member, limit, beforeId) {
      const versions = new Set(groupKeys.filter((k) => k.groupId === groupId && k.member === member).map((k) => k.version));
      return groupMessages
        .filter((m) => m.groupId === groupId && versions.has(m.version) && (beforeId === null || m.id < beforeId))
        .sort((x, y) => y.id - x.id)
        .slice(0, limit);
    },
    async ping() {
      return true;
    },
  };
}

module.exports = { createMemoryStore };
