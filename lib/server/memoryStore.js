function createMemoryStore(now = () => Date.now()) {
  const nonces = new Map();
  const messages = [];
  let nextId = 1;

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
    async ping() {
      return true;
    },
  };
}

module.exports = { createMemoryStore };
