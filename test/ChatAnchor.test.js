const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { DAY } = require("./helpers");

describe("ChatAnchor", function () {
  const root = ethers.id("root");

  async function deploy() {
    const [admin, relayer, other] = await ethers.getSigners();
    const anchor = await ethers.deployContract("ChatAnchor", [admin.address, relayer.address]);
    return { anchor, admin, relayer, other };
  }

  it("counts daily epochs from deployment", async function () {
    const { anchor } = await deploy();
    expect(await anchor.currentEpoch()).to.equal(0n);
    await time.increase(DAY);
    expect(await anchor.currentEpoch()).to.equal(1n);
  });

  it("stores the root of a finished epoch and emits Anchored", async function () {
    const { anchor, relayer } = await deploy();
    await time.increase(DAY);
    await expect(anchor.connect(relayer).anchor(0, root, "ipfs://batch"))
      .to.emit(anchor, "Anchored")
      .withArgs(0, root, "ipfs://batch");
    expect(await anchor.rootOf(0)).to.equal(root);
  });

  it("reverts for the current epoch", async function () {
    const { anchor, relayer } = await deploy();
    await expect(anchor.connect(relayer).anchor(0, root, "")).to.be.revertedWithCustomError(
      anchor,
      "EpochNotFinished"
    );
  });

  it("reverts for a second root, an empty root or a stranger", async function () {
    const { anchor, relayer, other } = await deploy();
    await time.increase(DAY);
    await expect(anchor.connect(relayer).anchor(0, ethers.ZeroHash, "")).to.be.revertedWithCustomError(
      anchor,
      "EmptyRoot"
    );
    await expect(anchor.connect(other).anchor(0, root, "")).to.be.revertedWithCustomError(
      anchor,
      "AccessControlUnauthorizedAccount"
    );
    await anchor.connect(relayer).anchor(0, root, "");
    await expect(anchor.connect(relayer).anchor(0, ethers.id("other"), "")).to.be.revertedWithCustomError(
      anchor,
      "AlreadyAnchored"
    );
  });

  it("lets the admin replace the relayer", async function () {
    const { anchor, admin, relayer, other } = await deploy();
    const role = await anchor.RELAYER_ROLE();
    await anchor.connect(admin).revokeRole(role, relayer.address);
    await anchor.connect(admin).grantRole(role, other.address);
    await time.increase(DAY);
    await expect(anchor.connect(relayer).anchor(0, root, "")).to.be.revertedWithCustomError(
      anchor,
      "AccessControlUnauthorizedAccount"
    );
    await anchor.connect(other).anchor(0, root, "");
  });
});
