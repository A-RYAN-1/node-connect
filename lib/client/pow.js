const { keccak_256 } = require("@noble/hashes/sha3");

// The proof of work Mining checks: keccak256(abi.encode(root, user, nonce)),
// three 32-byte words. Only the nonce word changes between attempts, so the
// input is built once and the last eight bytes are rewritten.
const hex = (value) => value.replace(/^0x/, "").padStart(64, "0");

function preimage(root, user) {
  const data = new Uint8Array(96);
  const words = hex(root) + hex(user);
  for (let i = 0; i < 64; i++) data[i] = parseInt(words.slice(i * 2, i * 2 + 2), 16);
  return data;
}

function hashValue(data) {
  let value = 0n;
  for (const byte of keccak_256(data)) value = (value << 8n) | BigInt(byte);
  return value;
}

function workHash(root, user, nonce) {
  const data = preimage(root, user);
  new DataView(data.buffer).setBigUint64(88, BigInt(nonce));
  return hashValue(data);
}

// Tries nonces from `from` until one hashes below `target`, or `limit`
// attempts are used up (then returns null). `onProgress(attempts)` is called
// every `every` attempts, so a worker can report and be stopped.
function solve(root, user, target, { from = 0n, limit = 2n ** 40n, every = 20000, onProgress } = {}) {
  const data = preimage(root, user);
  const view = new DataView(data.buffer);
  const goal = BigInt(target);
  for (let i = 0n; i < limit; i++) {
    const nonce = from + i;
    view.setBigUint64(88, nonce);
    if (hashValue(data) < goal) return nonce;
    if (onProgress && i % BigInt(every) === 0n && i > 0n) onProgress(i);
  }
  return null;
}

module.exports = { solve, workHash };
