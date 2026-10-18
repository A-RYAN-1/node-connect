const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { keccak_256 } = require("@noble/hashes/sha3");
const { StandardMerkleTree } = require("@openzeppelin/merkle-tree");

const DAY = 24 * 60 * 60;
const ENCRYPTION_KEY = ethers.id("encryption-key");

async function deployCore(relayer) {
  const [admin] = await ethers.getSigners();
  const registry = await ethers.deployContract("Registry");
  const anchor = await ethers.deployContract("ChatAnchor", [admin.address, relayer.address]);
  const mining = await ethers.deployContract("Mining", [
    await registry.getAddress(),
    await anchor.getAddress(),
  ]);
  const token = await ethers.getContractAt("NodeToken", await mining.token());
  return { registry, anchor, mining, token };
}

async function befriend(registry, a, b) {
  await registry.connect(a).request(b.address);
  await registry.connect(b).accept(a.address);
}

// Leaves are (user, friend, messageCount), the format Mining expects.
function buildTree(entries) {
  return StandardMerkleTree.of(
    entries.map(([user, friend, count]) => [user, friend, count]),
    ["address", "address", "uint256"]
  );
}

// Work hash as Mining computes it: keccak256(abi.encode(root, user, nonce)),
// three 32-byte words. Mining 2^16 hashes per claim needs a fast hash, so this
// uses noble directly and only rewrites the nonce word between attempts.
function preimage(root, user) {
  const data = new Uint8Array(96);
  data.set(ethers.getBytes(root), 0);
  data.set(ethers.getBytes(ethers.zeroPadValue(user, 32)), 32);
  return data;
}

function writeNonce(data, nonce) {
  new DataView(data.buffer).setBigUint64(88, nonce);
}

function hashValue(data) {
  return BigInt("0x" + Buffer.from(keccak_256(data)).toString("hex"));
}

function workHash(root, user, nonce) {
  const data = preimage(root, user);
  writeNonce(data, nonce);
  return hashValue(data);
}

// Finds a nonce whose work hash is below the target, like the browser miner.
function mine(root, user, target) {
  const data = preimage(root, user);
  for (let nonce = 0n; ; nonce++) {
    writeNonce(data, nonce);
    if (hashValue(data) < target) return nonce;
  }
}

async function nextEpoch(anchor) {
  const current = await anchor.currentEpoch();
  const genesis = await anchor.genesis();
  await time.increaseTo(genesis + (current + 1n) * BigInt(DAY));
  return current;
}

module.exports = { workHash, DAY, ENCRYPTION_KEY, deployCore, befriend, buildTree, mine, nextEpoch };
