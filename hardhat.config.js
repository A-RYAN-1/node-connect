require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

// Deployment settings come from .env (see .env.example). They are only
// needed for `npm run deploy`; compile and test run without them.
const { HOODI_RPC_URL, DEPLOYER_PRIVATE_KEY } = process.env;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    compilers: [
      // One compiler for every contract; the legacy ChatApp.sol (pragma >=0.7 <0.9) uses it too.
      {
        version: "0.8.28",
        settings: { evmVersion: "cancun", optimizer: { enabled: true, runs: 200 } },
      },
    ],
  },
  // Source verification on the Hoodi explorers (Blockscout needs no key).
  etherscan: {
    apiKey: { hoodi: "no-key-needed" },
    customChains: [
      {
        network: "hoodi",
        chainId: 560048,
        urls: {
          apiURL: "https://eth-hoodi.blockscout.com/api",
          browserURL: "https://eth-hoodi.blockscout.com",
        },
      },
    ],
  },
  sourcify: { enabled: false },
  networks: {
    hardhat: {
      chainId: 1337,
    },
    hoodi: {
      url: HOODI_RPC_URL || "https://ethereum-hoodi-rpc.publicnode.com",
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
      chainId: 560048,
    },
  },
};
