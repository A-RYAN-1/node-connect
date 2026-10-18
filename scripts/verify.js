// Verifies the four contracts of deployments/<network>.json on the explorer.
const path = require("path");
const hre = require("hardhat");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The free Blockscout API answers 429 when calls come too fast: wait and retry.
async function verify(address, constructorArguments, attempts = 5) {
  for (let attempt = 1; ; attempt++) {
    try {
      await hre.run("verify:verify", { address, constructorArguments });
      console.log(`verified ${address}`);
      break;
    } catch (error) {
      if (/already verified/i.test(error.message)) {
        console.log(`already verified ${address}`);
        break;
      }
      if (!/429|Too many|Failed to send/i.test(error.message) || attempt === attempts) throw error;
      await sleep(20_000 * attempt);
    }
  }
  await sleep(10_000);
}

async function main() {
  const file = path.join(__dirname, "..", "deployments", `${hre.network.name}.json`);
  const d = require(file);
  await verify(d.registry, []);
  await verify(d.chatAnchor, [d.deployer, d.relayer]);
  await verify(d.mining, [d.registry, d.chatAnchor]);
  await verify(d.token, [d.mining]);
  if (d.legacyChatApp) await verify(d.legacyChatApp, []);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
