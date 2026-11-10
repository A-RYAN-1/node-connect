const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
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

// The proof of work is the code the browser miner ships.
const { solve, workHash } = require("../lib/client/pow");

function mine(root, user, target) {
  return solve(root, user, target);
}

async function nextEpoch(anchor) {
  const current = await anchor.currentEpoch();
  const genesis = await anchor.genesis();
  await time.increaseTo(genesis + (current + 1n) * BigInt(DAY));
  return current;
}

module.exports = { workHash, DAY, ENCRYPTION_KEY, deployCore, befriend, buildTree, mine, nextEpoch };
