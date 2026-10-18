// Deploys Registry, ChatAnchor and Mining (Mining creates NodeToken) and
// records the addresses in deployments/<network>.json.
// Needs DEPLOYER_PRIVATE_KEY and RELAYER_ADDRESS in the environment (see
// .env.example); locally the second Hardhat account is the relayer.
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const [deployer, localRelayer] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error(
      `No deployer account for ${hre.network.name}: set DEPLOYER_PRIVATE_KEY in the environment`
    );
  }
  const relayer = process.env.RELAYER_ADDRESS || (hre.network.name === "hoodi" ? "" : localRelayer?.address);
  if (!hre.ethers.isAddress(relayer)) {
    throw new Error("Set RELAYER_ADDRESS to the public address of the relayer wallet");
  }

  const registry = await hre.ethers.deployContract("Registry");
  await registry.waitForDeployment();
  const anchor = await hre.ethers.deployContract("ChatAnchor", [deployer.address, relayer]);
  await anchor.waitForDeployment();
  const mining = await hre.ethers.deployContract("Mining", [
    await registry.getAddress(),
    await anchor.getAddress(),
  ]);
  await mining.waitForDeployment();

  const deployment = {
    network: hre.network.name,
    chainId: Number((await hre.ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    relayer,
    registry: await registry.getAddress(),
    chatAnchor: await anchor.getAddress(),
    mining: await mining.getAddress(),
    token: await mining.token(),
    anchorGenesis: Number(await anchor.genesis()),
  };

  const file = path.join(__dirname, "..", "deployments", `${hre.network.name}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(deployment, null, 2)}\n`);
  console.log(deployment);
  console.log(`Saved ${path.relative(path.join(__dirname, ".."), file)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
