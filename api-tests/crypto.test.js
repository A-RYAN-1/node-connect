const test = require("node:test");
const assert = require("node:assert/strict");
const { Wallet } = require("ethers");
const {
  KEY_MESSAGE,
  keyPairFromSignature,
  encrypt,
  decrypt,
  toHex,
} = require("../lib/client/crypto");

async function keysFor(wallet) {
  return keyPairFromSignature(await wallet.signMessage(KEY_MESSAGE));
}

test("the same wallet rebuilds the same key pair", async () => {
  const wallet = Wallet.createRandom();
  const a = await keysFor(wallet);
  const b = await keysFor(wallet);
  assert.equal(toHex(a.publicKey), toHex(b.publicKey));
  assert.equal(toHex(a.secretKey), toHex(b.secretKey));
});

test("different wallets get different keys", async () => {
  const a = await keysFor(Wallet.createRandom());
  const b = await keysFor(Wallet.createRandom());
  assert.notEqual(toHex(a.publicKey), toHex(b.publicKey));
});

test("both sides open a message; the wire form hides the text", async () => {
  const alice = await keysFor(Wallet.createRandom());
  const bob = await keysFor(Wallet.createRandom());
  const wire = encrypt("hello bob", alice.secretKey, toHex(bob.publicKey));
  assert.match(wire, /^[A-Za-z0-9+/]+={0,2}$/);
  assert.ok(!wire.includes("hello"));
  assert.equal(decrypt(wire, bob.secretKey, toHex(alice.publicKey)), "hello bob");
  assert.equal(decrypt(wire, alice.secretKey, toHex(bob.publicKey)), "hello bob");
});

test("a third key pair cannot open it", async () => {
  const alice = await keysFor(Wallet.createRandom());
  const bob = await keysFor(Wallet.createRandom());
  const eve = await keysFor(Wallet.createRandom());
  const wire = encrypt("secret", alice.secretKey, toHex(bob.publicKey));
  assert.equal(decrypt(wire, eve.secretKey, toHex(alice.publicKey)), null);
  assert.equal(decrypt(wire, eve.secretKey, toHex(bob.publicKey)), null);
});

test("garbage and tampered ciphertext return null", async () => {
  const alice = await keysFor(Wallet.createRandom());
  const bob = await keysFor(Wallet.createRandom());
  assert.equal(decrypt("not base64 !!", bob.secretKey, toHex(alice.publicKey)), null);
  assert.equal(decrypt("AAAA", bob.secretKey, toHex(alice.publicKey)), null);
  const wire = encrypt("x", alice.secretKey, toHex(bob.publicKey));
  const flipped = (wire[30] === "A" ? "B" : "A");
  const bad = wire.slice(0, 30) + flipped + wire.slice(31);
  assert.equal(decrypt(bad, bob.secretKey, toHex(alice.publicKey)), null);
});

test("unicode and long text survive", async () => {
  const alice = await keysFor(Wallet.createRandom());
  const bob = await keysFor(Wallet.createRandom());
  const text = "namaste नमस्ते ".repeat(40);
  const wire = encrypt(text, alice.secretKey, toHex(bob.publicKey));
  assert.equal(decrypt(wire, bob.secretKey, toHex(alice.publicKey)), text);
});
