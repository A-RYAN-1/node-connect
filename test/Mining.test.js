const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { DAY, ENCRYPTION_KEY, deployCore, befriend, buildTree, mine, workHash } = require("./helpers");

const HOUR = 3600;
const EASIEST = 2n ** 244n; // the highest target Mining can set: about 4k hashes

describe("Mining", function () {
  // Epoch 0 is over and anchored, we are one hour into epoch 1.
  async function fixture() {
    const [admin, relayer, alice, bob, carol, dave] = await ethers.getSigners();
    const core = await deployCore(relayer);
    const { registry, anchor } = core;
    for (const [signer, name] of [[alice, "alice"], [bob, "bob"], [carol, "carol"]]) {
      await registry.connect(signer).register(name, ENCRYPTION_KEY);
    }
    await befriend(registry, alice, bob);
    await befriend(registry, alice, carol);

    // Registered right before the epoch ends, so too new to mine in epoch 1.
    const genesis = await anchor.genesis();
    await time.increaseTo(genesis + BigInt(DAY) - 30n);
    await registry.connect(dave).register("dave", ENCRYPTION_KEY);
    await befriend(registry, dave, alice);

    const tree = buildTree([
      [alice.address, bob.address, 6n],
      [bob.address, alice.address, 7n],
      [carol.address, alice.address, 2n], // below MIN_MESSAGES
      [dave.address, alice.address, 9n],
    ]);
    await time.increaseTo(genesis + BigInt(DAY) + BigInt(HOUR));
    await anchor.connect(relayer).anchor(0, tree.root, "ipfs://epoch-0");
    return { ...core, tree, admin, relayer, alice, bob, carol, dave };
  }

  const proofOf = (tree, user, friend, count) => tree.getProof([user.address, friend.address, count]);
  const nonceFor = (tree, user, target) => mine(tree.root, user.address, target);

  async function claimAs(ctx, user, friend, count, overrides = {}) {
    const { mining, tree } = ctx;
    const target = await mining.targetFor(0);
    return mining
      .connect(user)
      .claim(
        overrides.epoch ?? 0,
        friend.address,
        count,
        overrides.proof ?? proofOf(tree, user, friend, count),
        overrides.nonce ?? nonceFor(tree, user, target)
      );
  }

  describe("setup", function () {
    it("creates the token with Mining as its only minter", async function () {
      const { mining, token } = await loadFixture(fixture);
      expect(await token.hasRole(await token.MINTER_ROLE(), await mining.getAddress())).to.equal(true);
      expect(await token.totalSupply()).to.equal(0n);
    });
  });

  describe("claim", function () {
    it("mints the base reward to a registered user with proven activity and work", async function () {
      const ctx = await loadFixture(fixture);
      const { mining, token, alice, bob } = ctx;
      await expect(claimAs(ctx, alice, bob, 6n))
        .to.emit(mining, "Claimed")
        .withArgs(0, alice.address, bob.address, ethers.parseEther("50"));
      expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("50"));
      expect(await mining.claimsIn(0)).to.equal(1n);
      expect(await mining.claimed(0, alice.address)).to.equal(true);
    });

    it("lets both sides of a pair claim with their own leaves", async function () {
      const ctx = await loadFixture(fixture);
      const { token, alice, bob } = ctx;
      await claimAs(ctx, alice, bob, 6n);
      await claimAs(ctx, bob, alice, 7n);
      expect(await token.totalSupply()).to.equal(ethers.parseEther("100"));
    });

    it("rejects a second claim of the same epoch (replay)", async function () {
      const ctx = await loadFixture(fixture);
      const { mining, tree, alice, bob } = ctx;
      await claimAs(ctx, alice, bob, 6n);
      // A different valid nonce must not pay again.
      const target = await mining.targetFor(0);
      const first = nonceFor(tree, alice, target);
      const second = mine(tree.root, alice.address, target) === first ? first + 1n : first;
      await expect(claimAs(ctx, alice, bob, 6n, { nonce: second })).to.be.revertedWithCustomError(
        mining,
        "AlreadyClaimed"
      );
    });

    it("binds the proof and the work to msg.sender", async function () {
      const ctx = await loadFixture(fixture);
      const { mining, tree, alice, bob, carol } = ctx;
      const target = await mining.targetFor(0);
      // Bob takes Alice's leaf and her nonce.
      await expect(
        mining
          .connect(bob)
          .claim(0, bob.address, 6n, proofOf(tree, alice, bob, 6n), nonceFor(tree, alice, target))
      ).to.be.revertedWithCustomError(mining, "NotFriends");
      // Carol (a friend of Alice) uses Alice's leaf and nonce.
      await expect(
        mining
          .connect(carol)
          .claim(0, bob.address, 6n, proofOf(tree, alice, bob, 6n), nonceFor(tree, alice, target))
      ).to.be.revertedWithCustomError(mining, "NotFriends");
      // Carol names Alice as friend but reuses a leaf that is not hers.
      await expect(
        mining
          .connect(carol)
          .claim(0, alice.address, 6n, proofOf(tree, alice, bob, 6n), nonceFor(tree, alice, target))
      ).to.be.revertedWithCustomError(mining, "InvalidActivityProof");
    });

    it("rejects work that was done for another address", async function () {
      const ctx = await loadFixture(fixture);
      const { mining, tree, alice, bob } = ctx;
      const target = await mining.targetFor(0);
      let wrong = nonceFor(tree, bob, target);
      // Make sure the nonce does not also happen to solve Alice's puzzle.
      while (workHash(tree.root, alice.address, wrong) < target) {
        wrong += 1n;
      }
      await expect(claimAs(ctx, alice, bob, 6n, { nonce: wrong })).to.be.revertedWithCustomError(
        mining,
        "InsufficientWork"
      );
    });

    it("reverts when the leaf is not in the tree or the count is changed", async function () {
      const ctx = await loadFixture(fixture);
      const { mining, alice, bob, tree } = ctx;
      await expect(
        claimAs(ctx, alice, bob, 50n, { proof: proofOf(tree, alice, bob, 6n) })
      ).to.be.revertedWithCustomError(mining, "InvalidActivityProof");
    });

    it("reverts below the minimum message count", async function () {
      const ctx = await loadFixture(fixture);
      const { mining, carol, alice } = ctx;
      await expect(claimAs(ctx, carol, alice, 2n)).to.be.revertedWithCustomError(
        mining,
        "TooFewMessages"
      );
    });

    it("reverts for a user who is not registered or not a friend", async function () {
      const ctx = await loadFixture(fixture);
      const { mining, tree, alice, bob, admin } = ctx;
      await expect(
        mining.connect(admin).claim(0, alice.address, 6n, proofOf(tree, alice, bob, 6n), 0)
      ).to.be.revertedWithCustomError(mining, "NotRegistered");
      await expect(
        mining.connect(bob).claim(0, (await ethers.getSigners())[6].address, 6n, [], 0)
      ).to.be.revertedWithCustomError(mining, "NotFriends");
    });

    it("reverts when the friendship has ended", async function () {
      const ctx = await loadFixture(fixture);
      const { mining, registry, alice, bob } = ctx;
      await registry.connect(bob).remove(alice.address);
      await expect(claimAs(ctx, alice, bob, 6n, { nonce: 0n })).to.be.revertedWithCustomError(
        mining,
        "NotFriends"
      );
    });

    it("reverts for an account younger than a day", async function () {
      const ctx = await loadFixture(fixture);
      const { mining, dave, alice } = ctx;
      await expect(claimAs(ctx, dave, alice, 9n, { nonce: 0n })).to.be.revertedWithCustomError(
        mining,
        "AccountTooNew"
      );
    });

    it("reverts for an epoch that is not the one before the current", async function () {
      const ctx = await loadFixture(fixture);
      const { mining, anchor, alice, bob } = ctx;
      await expect(claimAs(ctx, alice, bob, 6n, { epoch: 1, nonce: 0n })).to.be.revertedWithCustomError(
        mining,
        "NotClaimable"
      );
      await time.increase(DAY); // epoch 0 is now two epochs ago
      expect(await anchor.currentEpoch()).to.equal(2n);
      await expect(claimAs(ctx, alice, bob, 6n, { nonce: 0n })).to.be.revertedWithCustomError(
        mining,
        "NotClaimable"
      );
    });

    it("reverts when the epoch has no anchored root", async function () {
      const ctx = await loadFixture(fixture);
      const { mining, alice, bob } = ctx;
      await time.increase(DAY); // epoch 1 finished, nothing anchored for it
      await expect(
        mining.connect(alice).claim(1, bob.address, 6n, [], 0)
      ).to.be.revertedWithCustomError(mining, "NotAnchored");
    });

    it("reverts the whole transaction on failure: no mint, no state change", async function () {
      const ctx = await loadFixture(fixture);
      const { mining, token, alice, bob } = ctx;
      await expect(claimAs(ctx, alice, bob, 6n, { nonce: 0n })).to.be.reverted;
      expect(await token.totalSupply()).to.equal(0n);
      expect(await mining.claimed(0, alice.address)).to.equal(false);
      expect(await mining.claimsIn(0)).to.equal(0n);
    });
  });

  describe("reward schedule", function () {
    it("halves every 90 epochs", async function () {
      const { mining } = await loadFixture(fixture);
      const base = ethers.parseEther("50");
      expect(await mining.rewardFor(0)).to.equal(base);
      expect(await mining.rewardFor(89)).to.equal(base);
      expect(await mining.rewardFor(90)).to.equal(base / 2n);
      expect(await mining.rewardFor(180)).to.equal(base / 4n);
      expect(await mining.rewardFor(90 * 100)).to.equal(0n);
    });

    it("pays the halved reward in a later epoch", async function () {
      const ctx = await loadFixture(fixture);
      const { mining, token, anchor, relayer, alice, bob } = ctx;
      const genesis = await anchor.genesis();
      // Anchor epoch 90 with a fresh tree and claim it in epoch 91.
      const tree = buildTree([[alice.address, bob.address, 6n]]);
      await time.increaseTo(genesis + BigInt(DAY) * 91n + BigInt(HOUR));
      await anchor.connect(relayer).anchor(90, tree.root, "");
      const target = await mining.targetFor(90);
      await mining
        .connect(alice)
        .claim(90, bob.address, 6n, tree.getProof([alice.address, bob.address, 6n]), mine(tree.root, alice.address, target));
      expect(await token.balanceOf(alice.address)).to.equal(ethers.parseEther("25"));
    });
  });

  describe("difficulty retarget", function () {
    it("starts at the initial target and eases after an epoch without claims", async function () {
      const { mining } = await loadFixture(fixture);
      expect(await mining.targetFor(0)).to.equal(2n ** 240n);
      expect(await mining.targetFor(1)).to.equal(EASIEST); // epoch 0 had no claims
    });

    it("clamps the target between 1/16 and 16 times the initial target", async function () {
      const { mining } = await loadFixture(fixture);
      const initial = await mining.INITIAL_TARGET();
      // Epoch 2 follows epoch 1, which has no claims, so it is the easiest.
      expect(await mining.targetFor(2)).to.equal(initial * 16n);
    });
  });

  describe("per-epoch cap", function () {
    it("stops at MAX_CLAIMS_PER_EPOCH", async function () {
      const ctx = await loadFixture(fixture);
      const { mining, registry, anchor, relayer } = ctx;
      // Build a new epoch (1) where 101 funded wallets are friends of alice.
      const alice = ctx.alice;
      const wallets = [];
      for (let i = 0; i < 101; i++) {
        const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
        await ethers.provider.send("hardhat_setBalance", [wallet.address, "0x56BC75E2D63100000"]);
        await registry.connect(wallet).register(`w${i}`, ENCRYPTION_KEY);
        await befriend(registry, wallet, alice);
        wallets.push(wallet);
      }
      const genesis = await anchor.genesis();
      await time.increaseTo(genesis + BigInt(DAY) * 3n); // let all accounts age past a day
      const tree = buildTree(wallets.map((w) => [w.address, alice.address, 5n]));
      await anchor.connect(relayer).anchor(2, tree.root, "");
      await time.increaseTo(genesis + BigInt(DAY) * 3n + BigInt(HOUR));
      expect(await anchor.currentEpoch()).to.equal(3n);
      const target = await mining.targetFor(2);

      for (let i = 0; i < 100; i++) {
        await mining
          .connect(wallets[i])
          .claim(
            2,
            alice.address,
            5n,
            tree.getProof([wallets[i].address, alice.address, 5n]),
            mine(tree.root, wallets[i].address, target)
          );
      }
      expect(await mining.claimsIn(2)).to.equal(100n);
      // Claim 101 is refused even with valid proof and work.
      await expect(
        mining
          .connect(wallets[100])
          .claim(
            2,
            alice.address,
            5n,
            tree.getProof([wallets[100].address, alice.address, 5n]),
            mine(tree.root, wallets[100].address, target)
          )
      ).to.be.revertedWithCustomError(mining, "EpochFull");
      // 100 claims against a desired 10: the next target is 10x harder.
      expect(await mining.targetFor(3)).to.equal((2n ** 240n * 10n) / 100n);
    });
  });
});
