// End-to-end encryption for chat messages. Runs in the browser and in Node.
//
// Each user's X25519 key pair comes from one wallet signature of a fixed
// text, so the same wallet always rebuilds the same keys and nothing secret is
// stored anywhere. A message is nacl.box (X25519 + XSalsa20-Poly1305) from the
// sender's secret key to the recipient's public key; the wire form is
// base64(nonce + box). Either side can open it because box is symmetric in
// the pair.
const nacl = require("tweetnacl");

const KEY_MESSAGE =
  "Node Connect: create my chat encryption key.\n\nSigning does not cost gas or give anyone access to your funds. Only sign this on the Node Connect site.";

const toBase64 = (bytes) => {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
};

const fromBase64 = (text) => {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
};

const toHex = (bytes) =>
  `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;

const fromHex = (hex) => {
  const clean = hex.replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) throw new Error("A key is 32 bytes of hex");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return bytes;
};

// signature: the hex string a wallet returns for KEY_MESSAGE.
const keyPairFromSignature = (signature) => {
  const seed = nacl.hash(new TextEncoder().encode(signature)).slice(0, nacl.box.secretKeyLength);
  return nacl.box.keyPair.fromSecretKey(seed);
};

const encrypt = (text, secretKey, recipientPublicKeyHex) => {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const box = nacl.box(
    new TextEncoder().encode(text),
    nonce,
    fromHex(recipientPublicKeyHex),
    secretKey
  );
  const out = new Uint8Array(nonce.length + box.length);
  out.set(nonce);
  out.set(box, nonce.length);
  return toBase64(out);
};

// Returns the text, or null when the ciphertext is not for this key pair.
const decrypt = (ciphertext, secretKey, otherPublicKeyHex) => {
  let bytes;
  try {
    bytes = fromBase64(ciphertext);
  } catch {
    return null;
  }
  if (bytes.length <= nacl.box.nonceLength) return null;
  const opened = nacl.box.open(
    bytes.slice(nacl.box.nonceLength),
    bytes.slice(0, nacl.box.nonceLength),
    fromHex(otherPublicKeyHex),
    secretKey
  );
  return opened ? new TextDecoder().decode(opened) : null;
};

module.exports = { KEY_MESSAGE, keyPairFromSignature, encrypt, decrypt, toHex, fromHex };
