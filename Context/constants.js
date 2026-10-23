import registry from "./Registry.json";
import token from "./NodeToken.json";
import { NETWORK, REGISTRY_ADDRESS, TOKEN_ADDRESS } from "./config";

export const RegistryAddress = REGISTRY_ADDRESS;
export const RegistryABI = registry.abi;
export const TokenAddress = TOKEN_ADDRESS;
export const TokenABI = token.abi;

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
