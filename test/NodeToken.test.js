const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NodeToken", function () {
  async function deploy() {
    const [minter, other] = await ethers.getSigners();
    const token = await ethers.deployContract("NodeToken", [minter.address]);
    return { token, minter, other };
  }

  it("has the name, symbol and a 21M cap", async function () {
    const { token } = await deploy();
    expect(await token.name()).to.equal("Node Token");
    expect(await token.symbol()).to.equal("TOK");
    expect(await token.cap()).to.equal(ethers.parseEther("21000000"));
    expect(await token.totalSupply()).to.equal(0n);
  });

  it("lets only the minter mint", async function () {
    const { token, minter, other } = await deploy();
    await token.connect(minter).mint(other.address, 5n);
    expect(await token.balanceOf(other.address)).to.equal(5n);
    await expect(token.connect(other).mint(other.address, 1n)).to.be.revertedWithCustomError(
      token,
      "AccessControlUnauthorizedAccount"
    );
  });

  it("reverts above the cap", async function () {
    const { token, minter, other } = await deploy();
    await token.connect(minter).mint(other.address, await token.cap());
    await expect(token.connect(minter).mint(other.address, 1n)).to.be.revertedWithCustomError(
      token,
      "ERC20ExceededCap"
    );
  });

  it("has no admin who could add another minter", async function () {
    const { token, minter, other } = await deploy();
    expect(await token.hasRole(await token.DEFAULT_ADMIN_ROLE(), minter.address)).to.equal(false);
    await expect(
      token.connect(minter).grantRole(await token.MINTER_ROLE(), other.address)
    ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
  });
});
