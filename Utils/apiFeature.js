import { BrowserProvider, Contract } from "ethers";

import {
  ChatAppAddress,
  ChatAppABI,
  handleNetworkSwitch,
} from "../Context/constants";

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

export const connectingWithContract = async () => {
  if (!hasWallet()) throw new Error("MetaMask is not installed");
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  return new Contract(ChatAppAddress, ChatAppABI, signer);
};

// ethers v6 returns structs as Result proxies whose named fields are lost
// when spread, so the UI gets plain objects instead.
export const toUser = (u) => ({ name: u.name, accountAddress: u.accountAddress });
export const toFriend = (f) => ({ name: f.name, pubkey: f.pubkey });
export const toMessage = (m) => ({
  sender: m.sender,
  timestamp: Number(m.timestamp),
  msg: m.msg,
});

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
