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
const cipher = (text) => Buffer.from(text).toString("base64");
const wrapped = (tag) => Buffer.from(`wrapped-${tag}`).toString("base64");

before(async () => {
  env = await startServer();
});

after(async () => {
  if (env.useNeon) {
    for (const w of wallets) await env.store.deleteMessagesInvolving(w.address.toLowerCase());
  }
  await env.close();
});

const say = async (from, to, text) =>
  (await from.c.call("POST", "/api/messages", { recipient: to.address, ciphertext: cipher(text) })).json.message;
const unread = async (p) => (await p.c.call("GET", "/api/reads")).json.unread;

test("unread counts are per sender, and the sender has none for their own messages", async () => {
  const [a, b, c] = [await who(), await who(), await who()];
  await say(a, b, "one");
  await say(a, b, "two");
  await say(c, b, "three");
  assert.deepEqual((await unread(b)).direct, { [a.address]: 2, [c.address]: 1 });
  assert.deepEqual((await unread(a)).direct, {});
});

test("marking read lowers the count the same way for every session of that account", async () => {
  const [a, b] = [await who(), await who()];
  const first = await say(a, b, "one");
  const second = await say(a, b, "two");
  await say(a, b, "three");
  const mark = await b.c.call("POST", "/api/reads", { with: a.address, upTo: second.id });
  assert.equal(mark.status, 200);
  assert.equal(mark.json.lastRead, second.id);
  // a second browser signs in as the same wallet and sees the same count
  const other = client(env.base);
  await signIn(other, b.wallet);
  assert.deepEqual((await other.call("GET", "/api/reads")).json.unread.direct, { [a.address]: 1 });
  // a mark never moves back
  const back = await b.c.call("POST", "/api/reads", { with: a.address, upTo: first.id });
  assert.equal(back.json.lastRead, second.id);
});

test("the sender sees how far the friend has read, and a third address sees nothing", async () => {
  const [a, b, c] = [await who(), await who(), await who()];
  const m = await say(a, b, "hello");
  assert.equal((await a.c.call("GET", `/api/reads?with=${b.address}`)).json.theirLastRead, 0);
  await b.c.call("POST", "/api/reads", { with: a.address, upTo: m.id });
  assert.equal((await a.c.call("GET", `/api/reads?with=${b.address}`)).json.theirLastRead, m.id);
  assert.equal((await c.c.call("GET", `/api/reads?with=${b.address}`)).json.theirLastRead, 0);
  assert.equal((await c.c.call("GET", `/api/reads?with=${a.address}`)).json.theirLastRead, 0);
});

test("a mark holds ids only: no ciphertext, no text anywhere in the answers", async () => {
  const [a, b] = [await who(), await who()];
  const m = await say(a, b, "secret plans");
  const mark = await b.c.call("POST", "/api/reads", { with: a.address, upTo: m.id });
  const receipt = await a.c.call("GET", `/api/reads?with=${b.address}`);
  for (const res of [mark, receipt]) {
    const text = JSON.stringify(res.json);
    assert.ok(!text.includes(cipher("secret plans")) && !text.includes("secret"));
  }
  assert.deepEqual(Object.keys(mark.json), ["lastRead"]);
});

test("you cannot mark a message that is not in your chat", async () => {
  const [a, b, c] = [await who(), await who(), await who()];
  const m = await say(a, b, "private");
  assert.equal((await c.c.call("POST", "/api/reads", { with: a.address, upTo: m.id })).status, 404);
  assert.equal((await b.c.call("POST", "/api/reads", { with: c.address, upTo: m.id })).status, 404);
  assert.equal((await b.c.call("POST", "/api/reads", { with: a.address, upTo: m.id + 1000 })).status, 404);
});

test("bad bodies are refused and the route needs a session", async () => {
  const a = await who();
  assert.equal((await a.c.call("POST", "/api/reads", { with: a.address, upTo: 0 })).status, 400);
  assert.equal((await a.c.call("POST", "/api/reads", { upTo: 3 })).status, 400);
  assert.equal((await a.c.call("POST", "/api/reads", { with: "nope", upTo: 3 })).status, 400);
  assert.equal((await a.c.call("GET", "/api/reads?with=nope")).status, 400);
  assert.equal((await client(env.base).call("GET", "/api/reads")).status, 401);
});

test("group unread counts follow the key versions a member holds", async () => {
  const [a, b, c] = [await who(), await who(), await who()];
  const keys = [a, b, c].map((p) => ({ member: p.address, wrapped: wrapped(p.address.slice(2, 8)) }));
  const id = (await a.c.call("POST", "/api/groups", { keys })).json.group.id;
  const post = async (p, version, text) =>
    (await p.c.call("POST", "/api/groups/messages", { group: id, version, ciphertext: cipher(text) })).json.message;
  const first = await post(a, 1, "one");
  await post(b, 1, "two");
  assert.deepEqual((await unread(c)).groups, { [id]: 2 });
  assert.deepEqual((await unread(a)).groups, { [id]: 1 });
  await c.c.call("POST", "/api/reads", { group: id, upTo: first.id });
  assert.deepEqual((await unread(c)).groups, { [id]: 1 });
  // removing c moves the room to key version 2: c stops counting and cannot mark new messages
  const remaining = [a, b].map((p) => ({ member: p.address, wrapped: wrapped(`v2-${p.address.slice(2, 8)}`) }));
  assert.equal((await a.c.call("DELETE", "/api/groups/members", { group: id, member: c.address, keys: remaining })).status, 200);
  const later = await post(a, 2, "after removal");
  assert.deepEqual((await unread(c)).groups, {});
  assert.equal((await c.c.call("POST", "/api/reads", { group: id, upTo: later.id })).status, 404);
  const stranger = await who();
  assert.equal((await stranger.c.call("POST", "/api/reads", { group: id, upTo: first.id })).status, 404);
});
