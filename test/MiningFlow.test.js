const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { DAY, ENCRYPTION_KEY, deployCore, befriend, nextEpoch } = require("./helpers");
const { buildBatch, entriesFor } = require("../lib/server/activity");
const { solve } = require("../lib/client/pow");

// The shipped server and browser code against the real contracts: messages
// counted by the API become a root, the relayer anchors it, and a user claims
// with the proof and a nonce from the browser solver.
describe("Mining end to end", function () {
  it("pays a user for activity the API counted", async function () {
    const [, relayer, alice, bob, carol] = await ethers.getSigners();
    const { registry, anchor, mining, token } = await deployCore(relayer);
    for (const [signer, name] of [[alice, "alice"], [bob, "bob"], [carol, "carol"]]) {
      await registry.connect(signer).register(name, ENCRYPTION_KEY);
    }
    await befriend(registry, alice, bob);
    await befriend(registry, alice, carol);
    const lower = (s) => s.address.toLowerCase();

    // Epoch 0 activity as the store would count it: alice and bob talk both
    // ways, carol only writes to alice.
    const batch = buildBatch([
      { sender: lower(alice), recipient: lower(bob), count: 6 },
      { sender: lower(bob), recipient: lower(alice), count: 5 },
      { sender: lower(carol), recipient: lower(alice), count: 9 },
    ]);
    expect(batch.leaves).to.have.length(2);

    await nextEpoch(anchor); // accounts are now a day old, epoch 0 finished
    await anchor.connect(relayer).anchor(0, batch.tree.root, "https://example.test/api/mining/batch?epoch=0");

    const [entry] = entriesFor(batch, lower(alice));
    expect(entriesFor(batch, lower(carol))).to.deep.equal([]);
    const target = await mining.targetFor(0);
    const nonce = solve(batch.tree.root, alice.address, target);

    await expect(
      mining.connect(alice).claim(0, entry.friend, entry.messageCount, entry.proof, nonce)
    ).to.emit(mining, "Claimed");
    expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("50"));

    await expect(
      mining.connect(alice).claim(0, entry.friend, entry.messageCount, entry.proof, nonce)
    ).to.be.revertedWithCustomError(mining, "AlreadyClaimed");
    // The work is bound to the claimer: bob cannot reuse alice's nonce.
    const [bobEntry] = entriesFor(batch, lower(bob));
    await expect(
      mining.connect(bob).claim(0, bobEntry.friend, bobEntry.messageCount, bobEntry.proof, nonce)
    ).to.be.revertedWithCustomError(mining, "InsufficientWork");
  });
});
