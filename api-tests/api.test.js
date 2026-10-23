const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { startServer, client, siweText, signIn, newWallet } = require("./harness");

let env;
const wallets = [];
const wallet = () => {
  const w = newWallet();
  wallets.push(w);
  return w;
};

before(async () => {
  env = await startServer({ config: { messagesPerMinute: 5 } });
});

after(async () => {
  if (env.useNeon) {
    for (const w of wallets) await env.store.deleteMessagesInvolving(w.address.toLowerCase());
  }
  await env.close();
});

test("health reports ok", async () => {
  const res = await client(env.base).call("GET", "/api/health");
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { status: "ok" });
});

test("sign in sets an httpOnly cookie and the session shows the lowercase address", async () => {
  const w = wallet();
  const c = client(env.base);
  const res = await signIn(c, w);
  assert.equal(res.status, 200);
  assert.equal(res.json.address, w.address.toLowerCase());
  assert.match(res.setCookie, /HttpOnly/i);
  assert.match(res.setCookie, /SameSite=Lax/i);
  const me = await c.call("GET", "/api/auth/session");
  assert.equal(me.status, 200);
  assert.equal(me.json.address, w.address.toLowerCase());
});

test("a nonce works once: replaying the same signed message fails", async () => {
  const w = wallet();
  const c = client(env.base);
  const { json } = await c.call("GET", "/api/auth/nonce");
  const message = siweText({ wallet: w, nonce: json.nonce });
  const signature = await w.signMessage(message);
  assert.equal((await c.call("POST", "/api/auth/verify", { message, signature })).status, 200);
  const again = await client(env.base).call("POST", "/api/auth/verify", { message, signature });
  assert.equal(again.status, 400);
});

test("a nonce the server never issued is refused", async () => {
  const w = wallet();
  const message = siweText({ wallet: w, nonce: "neverIssued123" });
  const signature = await w.signMessage(message);
  const res = await client(env.base).call("POST", "/api/auth/verify", { message, signature });
  assert.equal(res.status, 400);
});

test("a signature from another wallet is refused with 401", async () => {
  const claimed = wallet();
  const attacker = wallet();
  const res = await signIn(client(env.base), claimed, { signer: attacker });
  assert.equal(res.status, 401);
});

test("a message for another site or another chain is refused", async () => {
  const w = wallet();
  const wrongDomain = await signIn(client(env.base), w, { domain: "evil.example" });
  assert.equal(wrongDomain.status, 400);
  const wrongChain = await signIn(client(env.base), w, { chainId: 1 });
  assert.equal(wrongChain.status, 400);
});

test("garbage in verify gives 400, not a crash", async () => {
  const c = client(env.base);
  assert.equal((await c.call("POST", "/api/auth/verify", {})).status, 400);
  const bad = await c.call("POST", "/api/auth/verify", { message: "hi", signature: "0x" });
  assert.equal(bad.status, 400);
});

test("logout ends the session", async () => {
  const w = wallet();
  const c = client(env.base);
  await signIn(c, w);
  assert.equal((await c.call("POST", "/api/auth/logout", {})).status, 200);
  assert.equal((await c.call("GET", "/api/auth/session")).status, 401);
});

test("messages need a session", async () => {
  const c = client(env.base);
  assert.equal((await c.call("GET", "/api/messages?with=" + wallet().address)).status, 401);
  const post = await c.call("POST", "/api/messages", {
    recipient: wallet().address,
    ciphertext: "YWJj",
  });
  assert.equal(post.status, 401);
});

test("a stored message is readable by both sides, newest first, and by nobody else", async () => {
  const alice = wallet();
  const bob = wallet();
  const carol = wallet();
  const a = client(env.base);
  const b = client(env.base);
  const cc = client(env.base);
  await signIn(a, alice);
  await signIn(b, bob);
  await signIn(cc, carol);

  const first = await a.call("POST", "/api/messages", {
    recipient: bob.address,
    ciphertext: "Zmlyc3Q=",
  });
  assert.equal(first.status, 201);
  assert.equal(first.json.message.sender, alice.address.toLowerCase());
  assert.equal(first.json.message.recipient, bob.address.toLowerCase());
  assert.ok(Number.isInteger(first.json.message.epoch) && first.json.message.epoch >= 0);
  await b.call("POST", "/api/messages", { recipient: alice.address, ciphertext: "c2Vjb25k" });

  for (const [who, other] of [
    [a, bob],
    [b, alice],
  ]) {
    const thread = await who.call("GET", "/api/messages?with=" + other.address);
    assert.equal(thread.status, 200);
    assert.deepEqual(
      thread.json.messages.map((m) => m.ciphertext),
      ["c2Vjb25k", "Zmlyc3Q="]
    );
  }
  const carolView = await cc.call("GET", "/api/messages?with=" + alice.address);
  assert.deepEqual(carolView.json.messages, []);
});

test("paging with limit and before walks the thread", async () => {
  const alice = wallet();
  const bob = wallet();
  const a = client(env.base);
  await signIn(a, alice);
  for (const text of ["bTE=", "bTI=", "bTM="]) {
    await a.call("POST", "/api/messages", { recipient: bob.address, ciphertext: text });
  }
  const page1 = await a.call("GET", `/api/messages?with=${bob.address}&limit=2`);
  assert.deepEqual(
    page1.json.messages.map((m) => m.ciphertext),
    ["bTM=", "bTI="]
  );
  const lastId = page1.json.messages[1].id;
  const page2 = await a.call("GET", `/api/messages?with=${bob.address}&limit=2&before=${lastId}`);
  assert.deepEqual(
    page2.json.messages.map((m) => m.ciphertext),
    ["bTE="]
  );
});

test("plain sentences, empty, oversize, self and bad addresses are rejected", async () => {
  const alice = wallet();
  const a = client(env.base);
  await signIn(a, alice);
  const bob = wallet().address;
  const post = (body) => a.call("POST", "/api/messages", body);
  assert.equal((await post({ recipient: bob, ciphertext: "hello there friend" })).status, 400);
  assert.equal((await post({ recipient: bob, ciphertext: "" })).status, 400);
  assert.equal((await post({ recipient: bob, ciphertext: "A".repeat(4097) })).status, 400);
  assert.equal((await post({ recipient: alice.address, ciphertext: "YWJj" })).status, 400);
  assert.equal((await post({ recipient: "0x123", ciphertext: "YWJj" })).status, 400);
  assert.equal((await a.call("GET", "/api/messages")).status, 400);
  assert.equal((await a.call("GET", `/api/messages?with=${bob}&limit=0`)).status, 400);
  assert.equal((await a.call("GET", `/api/messages?with=${bob}&before=abc`)).status, 400);
});

test("the sixth message in a minute is rate limited", async () => {
  const alice = wallet();
  const bob = wallet().address;
  const a = client(env.base);
  await signIn(a, alice);
  for (let i = 0; i < 5; i++) {
    const ok = await a.call("POST", "/api/messages", { recipient: bob, ciphertext: "YWJj" });
    assert.equal(ok.status, 201);
  }
  const blocked = await a.call("POST", "/api/messages", { recipient: bob, ciphertext: "YWJj" });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.error.code, "rate_limited");
});

test("non-JSON bodies get 415 and wrong methods get 405 with Allow", async () => {
  const res = await fetch(env.base + "/api/auth/verify", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "x",
  });
  assert.equal(res.status, 415);
  const wrong = await client(env.base).call("DELETE", "/api/messages");
  assert.equal(wrong.status, 405);
  assert.equal(wrong.headers.get("allow"), "POST, GET");
});

test("every response carries a request id and no-store", async () => {
  const res = await client(env.base).call("GET", "/api/health");
  assert.match(res.headers.get("x-request-id"), /^[0-9a-f-]{36}$/);
  assert.equal(res.headers.get("cache-control"), "no-store");
});
