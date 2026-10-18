const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error(
      `No deployer account for ${hre.network.name}: set DEPLOYER_PRIVATE_KEY in .env`
    );
  }

  const chatApp = await hre.ethers.deployContract("ChatApp");
  await chatApp.waitForDeployment();

  console.log(`ChatApp deployed to ${await chatApp.getAddress()} on ${hre.network.name}`);
  console.log("Set NEXT_PUBLIC_CONTRACT_ADDRESS to this address in .env");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
