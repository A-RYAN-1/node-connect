const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { StandardMerkleTree } = require("@openzeppelin/merkle-tree");
const { startServer, client, signIn, newWallet } = require("./harness");
const { buildBatch, entriesFor } = require("../lib/server/activity");
const { readConfig } = require("../lib/server/config");

const ZERO = "0x" + "0".repeat(64);
const genesis = readConfig({}).anchorGenesis;
const DAY = 86400;
let clock = (genesis + 3 * DAY + 100) * 1000;

const anchored = new Map();
const chain = {
  areFriends: async () => true,
  rootOf: async (epoch) => anchored.get(epoch) || ZERO,
  anchor: async (epoch, root, uri) => {
    anchored.set(epoch, root);
    anchored.uri = uri;
    return "0xtx";
  },
};

let env;
const [alice, bob, carol, dave, erin] = [newWallet(), newWallet(), newWallet(), newWallet(), newWallet()];
const lower = (w) => w.address.toLowerCase();

// gapSeconds is how long a person takes between messages; 0 is a script.
async function send(from, to, times, gapSeconds = 200) {
  const c = client(env.base);
  assert.equal((await signIn(c, from)).status, 200);
  for (let i = 0; i < times; i++) {
    const res = await c.call("POST", "/api/messages", { recipient: to.address, ciphertext: "Y2lwaGVy" });
    assert.equal(res.status, 201);
    clock += gapSeconds * 1000;
  }
  return c;
}

before(async () => {
  env = await startServer({
    now: () => clock,
    chain,
    config: { messagesPerMinute: 50, cronSecret: "s".repeat(24), batchBaseUrl: "https://example.test" },
  });
});

after(async () => {
  await env.close();
});

test("buildBatch pays only pairs that wrote back and reached the minimum", () => {
  const rows = [
    { sender: "0x" + "a".repeat(40), recipient: "0x" + "b".repeat(40), count: 5 },
    { sender: "0x" + "b".repeat(40), recipient: "0x" + "a".repeat(40), count: 1 },
    { sender: "0x" + "c".repeat(40), recipient: "0x" + "a".repeat(40), count: 9 },
    { sender: "0x" + "a".repeat(40), recipient: "0x" + "d".repeat(40), count: 4 },
    { sender: "0x" + "d".repeat(40), recipient: "0x" + "a".repeat(40), count: 4 },
  ];
  const batch = buildBatch(rows);
  assert.deepEqual(batch.leaves, [["0x" + "a".repeat(40), "0x" + "b".repeat(40), "5"]]);
  assert.equal(buildBatch([]), null);
});

test("proofs verify against the root with the contract's leaf format", () => {
  const a = "0x" + "a".repeat(40);
  const b = "0x" + "b".repeat(40);
  const batch = buildBatch([
    { sender: a, recipient: b, count: 7 },
    { sender: b, recipient: a, count: 6 },
  ]);
  const [entry] = entriesFor(batch, a);
  assert.equal(entry.friend, b);
  assert.equal(entry.messageCount, 7);
  assert.ok(
    StandardMerkleTree.verify(batch.tree.root, ["address", "address", "uint256"], [a, b, "7"], entry.proof)
  );
  assert.deepEqual(entriesFor(batch, "0x" + "e".repeat(40)), []);
});

test("an unfinished epoch is refused, a finished one without activity is 404", async () => {
  const c = await send(alice, bob, 0);
  const now = await c.call("GET", "/api/mining/batch?epoch=3");
  assert.equal(now.status, 400);
  const none = await c.call("GET", "/api/mining/batch?epoch=2");
  assert.equal(none.status, 404);
  assert.equal(none.json.error.code, "no_activity");
});

test("the proof and batch endpoints serve the epoch's claims and the cron anchors once", async () => {
  const a = await send(alice, bob, 5);
  await send(bob, alice, 2);
  await send(carol, alice, 6);
  // A fresh ring trading bursts: reciprocal and over the minimum, so only the abuse score stops it.
  await send(dave, erin, 6, 1);
  await send(erin, dave, 6, 1);
  clock += DAY * 1000;

  const batch = await client(env.base).call("GET", "/api/mining/batch?epoch=3");
  assert.equal(batch.status, 200, JSON.stringify(batch.json));
  assert.deepEqual(
    batch.json.leaves.map(([u, f, n]) => `${u}>${f}:${n}`),
    [`${lower(alice)}>${lower(bob)}:5`]
  );

  const proof = await a.call("GET", "/api/mining/proof");
  assert.equal(proof.status, 200);
  assert.equal(proof.json.epoch, 3);
  assert.equal(proof.json.anchored, false);
  assert.equal(proof.json.root, batch.json.root);
  assert.equal(proof.json.entries.length, 1);
  assert.equal(proof.json.entries[0].friend, lower(bob));
  assert.equal(proof.json.entries[0].messageCount, 5);

  const anon = await client(env.base).call("GET", "/api/mining/proof");
  assert.equal(anon.status, 401);

  const noSecret = await client(env.base).call("GET", "/api/mining/anchor");
  assert.equal(noSecret.status, 401);
  const wrong = await client(env.base).call("GET", "/api/mining/anchor", undefined, { authorization: "Bearer nope" });
  assert.equal(wrong.status, 401);

  const auth = { authorization: `Bearer ${"s".repeat(24)}` };
  const first = await client(env.base).call("GET", "/api/mining/anchor", undefined, auth);
  assert.equal(first.json.status, "anchored");
  assert.equal(first.json.root, batch.json.root);
  assert.equal(anchored.uri, "https://example.test/api/mining/batch?epoch=3");
  const second = await client(env.base).call("GET", "/api/mining/anchor", undefined, auth);
  assert.equal(second.json.status, "already_anchored");

  const after = await a.call("GET", "/api/mining/proof");
  assert.equal(after.json.anchored, true);
});
