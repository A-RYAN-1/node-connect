const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { ENCRYPTION_KEY, befriend } = require("./helpers");

describe("Registry", function () {
  async function fixture() {
    const [alice, bob, carol] = await ethers.getSigners();
    const registry = await ethers.deployContract("Registry");
    await registry.connect(alice).register("alice", ENCRYPTION_KEY);
    await registry.connect(bob).register("bob", ENCRYPTION_KEY);
    return { registry, alice, bob, carol };
  }

  const revertsWith = (registry, promise, error) =>
    expect(promise).to.be.revertedWithCustomError(registry, error);

  describe("profiles", function () {
    it("registers and emits Registered", async function () {
      const [alice] = await ethers.getSigners();
      const registry = await ethers.deployContract("Registry");
      await expect(registry.register("alice", ENCRYPTION_KEY))
        .to.emit(registry, "Registered")
        .withArgs(alice.address, "alice", ENCRYPTION_KEY);
      const profile = await registry.profileOf(alice.address);
      expect(profile.name).to.equal("alice");
      expect(profile.encryptionKey).to.equal(ENCRYPTION_KEY);
      expect(await registry.isRegistered(alice.address)).to.equal(true);
    });

    it("reverts on a second registration, an empty or long name, a zero key", async function () {
      const { registry, alice, carol } = await loadFixture(fixture);
      await revertsWith(registry, registry.connect(alice).register("again", ENCRYPTION_KEY), "AlreadyRegistered");
      await revertsWith(registry, registry.connect(carol).register("", ENCRYPTION_KEY), "InvalidName");
      await revertsWith(
        registry,
        registry.connect(carol).register("x".repeat(33), ENCRYPTION_KEY),
        "InvalidName"
      );
      await revertsWith(
        registry,
        registry.connect(carol).register("carol", ethers.ZeroHash),
        "InvalidEncryptionKey"
      );
    });

    it("updates the profile only for registered users", async function () {
      const { registry, alice, carol } = await loadFixture(fixture);
      await expect(registry.connect(alice).updateProfile("alice2", ethers.id("new")))
        .to.emit(registry, "ProfileUpdated")
        .withArgs(alice.address, "alice2", ethers.id("new"));
      expect((await registry.profileOf(alice.address)).name).to.equal("alice2");
      await revertsWith(
        registry,
        registry.connect(carol).updateProfile("carol", ENCRYPTION_KEY),
        "NotRegistered"
      );
    });
  });

  describe("friendships", function () {
    it("needs a request and an acceptance", async function () {
      const { registry, alice, bob } = await loadFixture(fixture);
      await expect(registry.connect(alice).request(bob.address))
        .to.emit(registry, "FriendRequested")
        .withArgs(alice.address, bob.address);
      expect(await registry.areFriends(alice.address, bob.address)).to.equal(false);

      await expect(registry.connect(bob).accept(alice.address))
        .to.emit(registry, "FriendAccepted")
        .withArgs(alice.address, bob.address);
      expect(await registry.areFriends(alice.address, bob.address)).to.equal(true);
      expect(await registry.areFriends(bob.address, alice.address)).to.equal(true);
      expect(await registry.hasRequested(alice.address, bob.address)).to.equal(false);
    });

    it("does not let the requester accept their own request", async function () {
      const { registry, alice, bob } = await loadFixture(fixture);
      await registry.connect(alice).request(bob.address);
      await revertsWith(registry, registry.connect(alice).accept(bob.address), "NoRequest");
    });

    it("rejects self, unregistered, duplicate and already-friend requests", async function () {
      const { registry, alice, bob, carol } = await loadFixture(fixture);
      await revertsWith(registry, registry.connect(alice).request(alice.address), "SelfAction");
      await revertsWith(registry, registry.connect(alice).request(carol.address), "NotRegistered");
      await registry.connect(alice).request(bob.address);
      await revertsWith(registry, registry.connect(alice).request(bob.address), "AlreadyRequested");
      await registry.connect(bob).accept(alice.address);
      await revertsWith(registry, registry.connect(alice).request(bob.address), "AlreadyFriends");
    });

    it("lets the recipient decline, and the requester ask again", async function () {
      const { registry, alice, bob } = await loadFixture(fixture);
      await registry.connect(alice).request(bob.address);
      await expect(registry.connect(bob).decline(alice.address))
        .to.emit(registry, "FriendDeclined")
        .withArgs(alice.address, bob.address);
      await revertsWith(registry, registry.connect(bob).decline(alice.address), "NoRequest");
      await registry.connect(alice).request(bob.address);
    });

    it("removes a friendship for both sides", async function () {
      const { registry, alice, bob, carol } = await loadFixture(fixture);
      await befriend(registry, alice, bob);
      await revertsWith(registry, registry.connect(carol).remove(alice.address), "NotFriends");
      await expect(registry.connect(bob).remove(alice.address))
        .to.emit(registry, "FriendRemoved")
        .withArgs(bob.address, alice.address);
      expect(await registry.areFriends(alice.address, bob.address)).to.equal(false);
      expect(await registry.areFriends(bob.address, alice.address)).to.equal(false);
    });
  });

  describe("blocking", function () {
    it("ends the friendship and stops new requests", async function () {
      const { registry, alice, bob } = await loadFixture(fixture);
      await befriend(registry, alice, bob);
      await expect(registry.connect(bob).blockUser(alice.address))
        .to.emit(registry, "Blocked")
        .withArgs(bob.address, alice.address);
      expect(await registry.areFriends(alice.address, bob.address)).to.equal(false);
      expect(await registry.isBlocked(bob.address, alice.address)).to.equal(true);

      await revertsWith(registry, registry.connect(alice).request(bob.address), "BlockedByRecipient");
      await revertsWith(registry, registry.connect(bob).request(alice.address), "BlockedByYou");
    });

    it("clears a pending request", async function () {
      const { registry, alice, bob } = await loadFixture(fixture);
      await registry.connect(alice).request(bob.address);
      await registry.connect(bob).blockUser(alice.address);
      await revertsWith(registry, registry.connect(bob).accept(alice.address), "NoRequest");
    });

    it("allows requests again after unblocking", async function () {
      const { registry, alice, bob } = await loadFixture(fixture);
      await registry.connect(bob).blockUser(alice.address);
      await expect(registry.connect(bob).unblockUser(alice.address))
        .to.emit(registry, "Unblocked")
        .withArgs(bob.address, alice.address);
      await registry.connect(alice).request(bob.address);
    });

    it("cannot block yourself", async function () {
      const { registry, alice } = await loadFixture(fixture);
      await revertsWith(registry, registry.connect(alice).blockUser(alice.address), "SelfAction");
    });
  });
});
