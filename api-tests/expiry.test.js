const { test } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, client, siweText, newWallet } = require("./harness");

test("a live nonce is consumable exactly once", async () => {
  const { createMemoryStore } = require("../lib/server/memoryStore");
  const { createNeonStore } = require("../lib/server/neonStore");
  const store =
    process.env.STORE === "neon"
      ? createNeonStore(process.env.DATABASE_URL)
      : createMemoryStore();
  const live = "live-nonce-" + Date.now();
  await store.createNonce(live, 60);
  assert.equal(await store.consumeNonce(live), true);
  assert.equal(await store.consumeNonce(live), false);
});

test("an expired nonce row is not consumable", async () => {
  const { createMemoryStore } = require("../lib/server/memoryStore");
  const { createNeonStore } = require("../lib/server/neonStore");
  const store =
    process.env.STORE === "neon"
      ? createNeonStore(process.env.DATABASE_URL)
      : createMemoryStore();
  const name = "expired-row-" + Date.now();
  await store.createNonce(name, -10);
  assert.equal(await store.consumeNonce(name), false);
});

test(
  "a nonce older than five minutes is refused",
  { skip: process.env.STORE === "neon" },
  async () => {
    let clock = Date.UTC(2026, 9, 23);
    const env = await startServer({ now: () => clock });
    try {
      const c = client(env.base);
      const { json } = await c.call("GET", "/api/auth/nonce");
      const w = newWallet();
      const message = siweText({ wallet: w, nonce: json.nonce });
      const signature = await w.signMessage(message);
      clock += 301 * 1000;
      const res = await c.call("POST", "/api/auth/verify", { message, signature });
      assert.equal(res.status, 400);
    } finally {
      await env.close();
    }
  }
);
