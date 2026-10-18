// Verifies the four contracts of deployments/<network>.json on the explorer.
const path = require("path");
const hre = require("hardhat");

async function verify(address, constructorArguments) {
  try {
    await hre.run("verify:verify", { address, constructorArguments });
    console.log(`verified ${address}`);
  } catch (error) {
    if (/already verified/i.test(error.message)) {
      console.log(`already verified ${address}`);
      return;
    }
    throw error;
  }
}

async function main() {
  const file = path.join(__dirname, "..", "deployments", `${hre.network.name}.json`);
  const d = require(file);
  await verify(d.registry, []);
  await verify(d.chatAnchor, [d.deployer, d.relayer]);
  await verify(d.mining, [d.registry, d.chatAnchor]);
  await verify(d.token, [d.mining]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
