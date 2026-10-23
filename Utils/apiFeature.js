import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";

import {
  RegistryAddress,
  RegistryABI,
  TokenAddress,
  TokenABI,
  handleNetworkSwitch,
} from "../Context/constants";
import { NETWORK, REGISTRY_START_BLOCK } from "../Context/config";

export const hasWallet = () =>
  typeof window !== "undefined" && Boolean(window.ethereum);

// Returns the connected account without prompting, or "" if none.
export const checkIfWalletConnected = async () => {
  if (!hasWallet()) return "";
  const accounts = await window.ethereum.request({ method: "eth_accounts" });
  return accounts[0] || "";
};

// Prompts MetaMask to connect, switches to the configured network and
// returns the selected account.
export const connectWallet = async () => {
  if (!hasWallet()) throw new Error("MetaMask is not installed");
  const accounts = await window.ethereum.request({
    method: "eth_requestAccounts",
  });
  await handleNetworkSwitch();
  return accounts[0] || "";
};

const readProvider = () => new JsonRpcProvider(NETWORK.rpcUrls[0], undefined, { staticNetwork: true });

// Read-only contracts go to the public RPC: they need no wallet prompt and
// work before the wallet is connected.
export const readRegistry = () => new Contract(RegistryAddress, RegistryABI, readProvider());
export const readToken = () => new Contract(TokenAddress, TokenABI, readProvider());

// The Registry with the wallet as signer, for transactions.
export const connectingWithContract = async () => {
  if (!hasWallet()) throw new Error("MetaMask is not installed");
  const signer = await new BrowserProvider(window.ethereum).getSigner();
  return new Contract(RegistryAddress, RegistryABI, signer);
};

export const signWithWallet = (message, account) =>
  window.ethereum.request({ method: "personal_sign", params: [message, account] });

// Public RPC nodes cap the block range of one log query, so read in steps.
const LOG_STEP = 9000;
export const queryAllLogs = async (contract, filter) => {
  const latest = await contract.runner.provider.getBlockNumber();
  const ranges = [];
  for (let from = REGISTRY_START_BLOCK; from <= latest; from += LOG_STEP) {
    ranges.push([from, Math.min(from + LOG_STEP - 1, latest)]);
  }
  const parts = await Promise.all(
    ranges.map(([from, to]) => contract.queryFilter(filter, from, to))
  );
  return parts.flat();
};

// MetaMask and ethers report the same user action under different codes.
const errorCode = (error) => error?.code ?? error?.info?.error?.code;

// Turns a wallet or contract error into one sentence a person can act on.
export const errorMessage = (error) => {
  const code = errorCode(error);
  if (code === 4001 || code === "ACTION_REJECTED") {
    return "You declined the request in MetaMask. Nothing was changed.";
  }
  if (code === -32002) {
    return "MetaMask already has a request waiting. Open the MetaMask extension, approve or reject it, then try again.";
  }
  if (code === "INSUFFICIENT_FUNDS") {
    return "This account has no test ETH to pay the network fee.";
  }
  return (
    error?.reason ||
    error?.info?.error?.message ||
    error?.shortMessage ||
    error?.message ||
    "Something went wrong"
  );
};

export const shortAddress = (address) =>
  address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "";

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});
const dayFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

// "3:42 PM" for today, "12 Oct 2026, 3:42 PM" for any other day.
export const formatTime = (seconds) => {
  const date = new Date(Number(seconds) * 1000);
  const time = timeFormat.format(date);
  return date.toDateString() === new Date().toDateString()
    ? time
    : `${dayFormat.format(date)}, ${time}`;
};
