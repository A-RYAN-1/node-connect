const { StandardMerkleTree } = require("@openzeppelin/merkle-tree");

// The leaf layout Mining.claim verifies: (user, friend, messageCount),
// double hashed by the library the same way the contract does.
const LEAF_TYPES = ["address", "address", "uint256"];
const MIN_MESSAGES = 5;

// rows: { sender, recipient, count } of one epoch, addresses lowercase.
// A user earns a leaf for a friend when they sent at least `minMessages`
// to that friend and the friend wrote back at least once, so one-way
// spam never pays. Returns null when no leaf qualifies.
function buildBatch(rows, minMessages = MIN_MESSAGES) {
  const sent = new Map(rows.map((r) => [`${r.sender}>${r.recipient}`, Number(r.count)]));
  const leaves = rows
    .filter((r) => Number(r.count) >= minMessages && (sent.get(`${r.recipient}>${r.sender}`) || 0) > 0)
    .map((r) => [r.sender, r.recipient, String(r.count)])
    .sort((a, b) => (a[0] + a[1] < b[0] + b[1] ? -1 : 1));
  if (leaves.length === 0) return null;
  return { tree: StandardMerkleTree.of(leaves, LEAF_TYPES), leaves };
}

// What anyone needs to recompute the root: the leaves, in order.
function publish(epoch, batch) {
  return { epoch, root: batch.tree.root, leaves: batch.leaves };
}

// Every claim the user can make from this batch, with its Merkle proof.
function entriesFor(batch, user) {
  const entries = [];
  for (const [index, leaf] of batch.tree.entries()) {
    if (leaf[0] === user) {
      entries.push({ friend: leaf[1], messageCount: Number(leaf[2]), proof: batch.tree.getProof(index) });
    }
  }
  return entries;
}

module.exports = { buildBatch, publish, entriesFor, MIN_MESSAGES };
