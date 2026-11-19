const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, client, signIn, newWallet } = require("./harness");

let env;
const wallets = [];
const who = async () => {
  const wallet = newWallet();
  wallets.push(wallet);
  const c = client(env.base);
  await signIn(c, wallet);
  return { wallet, c, address: wallet.address.toLowerCase() };
};
// Stand-ins for wrapped keys: the server only checks they are base64 text.
const wrapped = (tag) => Buffer.from(`wrapped-${tag}`).toString("base64");
const keysFor = (...people) =>
  people.map((p) => ({ member: p.address, wrapped: wrapped(p.address.slice(2, 8)) }));
const cipher = (text) => Buffer.from(text).toString("base64");

before(async () => {
  env = await startServer({ config: { messagesPerMinute: 4 } });
});

after(async () => {
  if (env.useNeon) {
    for (const w of wallets) await env.store.deleteMessagesInvolving(w.address.toLowerCase());
  }
  await env.close();
});

async function room() {
  const [a, b, c] = [await who(), await who(), await who()];
  const made = await a.c.call("POST", "/api/groups", { keys: keysFor(a, b, c) });
  assert.equal(made.status, 201);
  return { a, b, c, id: made.json.group.id };
}

const send = (p, id, version, text) =>
  p.c.call("POST", "/api/groups/messages", { group: id, version, ciphertext: cipher(text) });

test("three accounts hold the same room and each gets only their own wrapped key", async () => {
  const { a, b, c, id } = await room();
  for (const p of [a, b, c]) {
    const res = await p.c.call("GET", "/api/groups");
    assert.equal(res.status, 200);
    const group = res.json.groups.find((g) => g.id === id);
    assert.equal(group.owner, a.address);
    assert.deepEqual([...group.members].sort(), [a.address, b.address, c.address].sort());
    assert.equal(group.keys.length, 1);
    assert.equal(group.keys[0].wrapped, wrapped(p.address.slice(2, 8)));
  }
});

test("members exchange ciphertext, a stranger gets 404 and reads nothing", async () => {
  const { a, b, c, id } = await room();
  const stranger = await who();
  assert.equal((await send(b, id, 1, "hi all")).status, 201);
  assert.equal((await send(c, id, 1, "hi b")).status, 201);
  const read = await a.c.call("GET", `/api/groups/messages?group=${id}`);
  assert.equal(read.json.messages.length, 2);
  assert.equal(read.json.messages[0].ciphertext, cipher("hi b"));
  assert.equal((await stranger.c.call("GET", `/api/groups/messages?group=${id}`)).status, 404);
  assert.equal((await send(stranger, id, 1, "x")).status, 404);
  assert.equal((await stranger.c.call("GET", "/api/groups")).json.groups.length, 0);
});

test("create is refused for non-friends, a missing owner key, duplicates and bad keys", async () => {
  const strict = await startServer({ friendsOnly: true });
  try {
    const [a, b] = [newWallet(), newWallet()];
    const ca = client(strict.base);
    await signIn(ca, a);
    const address = (w) => w.address.toLowerCase();
    const keys = [
      { member: address(a), wrapped: wrapped("a") },
      { member: address(b), wrapped: wrapped("b") },
    ];
    assert.equal((await ca.call("POST", "/api/groups", { keys })).status, 403);
    strict.befriend(address(a), address(b));
    assert.equal((await ca.call("POST", "/api/groups", { keys })).status, 201);
    assert.equal((await ca.call("POST", "/api/groups", { keys: [keys[0]] })).status, 400);
    const other = { member: "0x" + "1".repeat(40), wrapped: wrapped("c") };
    assert.equal((await ca.call("POST", "/api/groups", { keys: [keys[1], other] })).status, 400);
    assert.equal((await ca.call("POST", "/api/groups", { keys: [keys[0], keys[0]] })).status, 400);
    const bad = { ...keys[1], wrapped: "not base64 !!" };
    assert.equal((await ca.call("POST", "/api/groups", { keys: [keys[0], bad] })).status, 400);
  } finally {
    await strict.close();
  }
});

test("only the owner adds a member, who then holds a key for the current version", async () => {
  const { a, b, id } = await room();
  const d = await who();
  const add = (p) =>
    p.c.call("POST", "/api/groups/members", { group: id, member: d.address, wrapped: wrapped("d") });
  assert.equal((await add(b)).status, 403);
  assert.equal((await add(a)).status, 201);
  assert.equal((await add(a)).status, 400);
  const mine = (await d.c.call("GET", "/api/groups")).json.groups.find((g) => g.id === id);
  assert.equal(mine.members.length, 4);
  assert.equal(mine.keys[0].version, 1);
});

test("a new member reads the messages of the key version they were added to", async () => {
  const { a, b, id } = await room();
  const d = await who();
  await send(a, id, 1, "before d");
  await a.c.call("POST", "/api/groups/members", { group: id, member: d.address, wrapped: wrapped("d") });
  await send(b, id, 1, "after d");
  const seen = (await d.c.call("GET", `/api/groups/messages?group=${id}`)).json.messages;
  assert.equal(seen.length, 2);
});

test("removing a member needs fresh keys for exactly the remaining members and starts a new version", async () => {
  const { a, b, c, id } = await room();
  const remove = (p, member, keys) =>
    p.c.call("DELETE", "/api/groups/members", { group: id, member, keys });
  assert.equal((await remove(a, c.address, keysFor(a, b, c))).status, 400);
  assert.equal((await remove(a, c.address, keysFor(a))).status, 400);
  assert.equal((await remove(b, c.address, keysFor(a, b))).status, 403);
  assert.equal((await remove(a, a.address, keysFor(b, c))).status, 400);
  const done = await remove(a, c.address, keysFor(a, b));
  assert.equal(done.status, 200);
  assert.equal(done.json.group.version, 2);
  const theirs = (await b.c.call("GET", "/api/groups")).json.groups.find((g) => g.id === id);
  assert.deepEqual(theirs.keys.map((k) => k.version), [1, 2]);
});

test("a removed member loses the room and cannot read or write new messages", async () => {
  const { a, b, c, id } = await room();
  await send(c, id, 1, "c old");
  await a.c.call("DELETE", "/api/groups/members", { group: id, member: c.address, keys: keysFor(a, b) });
  assert.equal((await send(b, id, 2, "new secret")).status, 201);
  assert.equal((await c.c.call("GET", `/api/groups/messages?group=${id}`)).status, 404);
  assert.equal((await send(c, id, 2, "sneak")).status, 404);
  assert.equal((await c.c.call("GET", "/api/groups")).json.groups.length, 0);
  const all = (await a.c.call("GET", `/api/groups/messages?group=${id}`)).json.messages.map((m) => m.version);
  assert.deepEqual(all, [2, 1]);
});

test("a message on an old key version is refused with 409", async () => {
  const { a, b, c, id } = await room();
  await a.c.call("DELETE", "/api/groups/members", { group: id, member: c.address, keys: keysFor(a, b) });
  const stale = await send(b, id, 1, "old key");
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error.code, "stale_key");
});

test("plain text, an empty or oversize ciphertext and a missing version are refused", async () => {
  const { a, id } = await room();
  const raw = (body) => a.c.call("POST", "/api/groups/messages", { group: id, version: 1, ...body });
  assert.equal((await raw({ ciphertext: "this is plain text!" })).status, 400);
  assert.equal((await raw({ ciphertext: "" })).status, 400);
  assert.equal((await raw({ ciphertext: "A".repeat(env.config.maxCiphertextChars + 1) })).status, 400);
  const noVersion = await a.c.call("POST", "/api/groups/messages", { group: id, ciphertext: cipher("x") });
  assert.equal(noVersion.status, 409);
});

test("group messages count toward the per-minute rate limit", async () => {
  const { a, id } = await room();
  for (let i = 0; i < 4; i += 1) assert.equal((await send(a, id, 1, `m${i}`)).status, 201);
  assert.equal((await send(a, id, 1, "over")).status, 429);
});

test("group routes need a session", async () => {
  const anon = client(env.base);
  assert.equal((await anon.call("GET", "/api/groups")).status, 401);
  assert.equal((await anon.call("GET", "/api/groups/messages?group=1")).status, 401);
  assert.equal((await anon.call("POST", "/api/groups", { keys: [] })).status, 401);
});

test("the store holds no plaintext for a group", async () => {
  const { a, id } = await room();
  await send(a, id, 1, "top secret plan");
  const group = await env.store.getGroup(id);
  const rows = await env.store.listGroupMessages(id, a.address, 10, null);
  assert.ok(!JSON.stringify({ group, rows }).includes("top secret plan"));
});
