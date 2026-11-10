import registry from "./Registry.json";
import token from "./NodeToken.json";
import { NETWORK, MINING_ADDRESS, REGISTRY_ADDRESS, TOKEN_ADDRESS } from "./config";

export const RegistryAddress = REGISTRY_ADDRESS;
export const RegistryABI = registry.abi;
export const TokenAddress = TOKEN_ADDRESS;
export const TokenABI = token.abi;
export const MiningAddress = MINING_ADDRESS;
// Only what the site calls; the full ABI is in artifacts after `npm run compile`.
export const MiningABI = [
  "function claim(uint256 epoch, address friend, uint256 messageCount, bytes32[] proof, uint256 nonce)",
  "function targetFor(uint256 epoch) view returns (uint256)",
  "function rewardFor(uint256 epoch) pure returns (uint256)",
  "function claimed(uint256 epoch, address user) view returns (bool)",
  "function claimsIn(uint256 epoch) view returns (uint256)",
  "function MAX_CLAIMS_PER_EPOCH() view returns (uint256)",
];

// Switch MetaMask to the configured network, adding it first if MetaMask
// does not know it yet (error 4902).
export const handleNetworkSwitch = async () => {
  if (!window.ethereum) throw new Error("MetaMask is not installed");
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: NETWORK.chainId }],
    });
  } catch (error) {
    if (error.code !== 4902) throw error;
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [NETWORK],
    });
  }
};
