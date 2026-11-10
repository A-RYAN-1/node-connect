import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";

import { MiningAddress, MiningABI } from "../Context/constants";
import { NETWORK } from "../Context/config";

const get = async (path) => {
  const res = await fetch(path, { credentials: "same-origin" });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const error = new Error(json?.error?.message || `Request failed (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return json;
};

// The signed-in user's claims for the epoch that just ended.
export const loadClaims = () => get("/api/mining/proof");

const readMining = () =>
  new Contract(
    MiningAddress,
    MiningABI,
    new JsonRpcProvider(NETWORK.rpcUrls[0], undefined, { staticNetwork: true })
  );

export const loadEpochState = async (epoch, account) => {
  const mining = readMining();
  const [target, reward, claimed, claims, cap] = await Promise.all([
    mining.targetFor(epoch),
    mining.rewardFor(epoch),
    mining.claimed(epoch, account),
    mining.claimsIn(epoch),
    mining.MAX_CLAIMS_PER_EPOCH(),
  ]);
  return { target, reward, claimed, claims, full: claims >= cap };
};

// Runs the proof of work in a Web Worker so the page stays responsive.
// `onProgress(attempts)` reports roughly every twenty thousand tries.
export const solveWork = (root, user, target, onProgress) =>
  new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../lib/client/pow.worker.js", import.meta.url));
    worker.onmessage = ({ data }) => {
      if (data.progress) return onProgress(Number(data.progress));
      worker.terminate();
      if (data.error) reject(new Error(data.error));
      else resolve(BigInt(data.nonce));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "The miner stopped"));
    };
    worker.postMessage({ root, user, target: target.toString() });
  });

// Sends the claim from the wallet and waits for it to be mined.
export const sendClaim = async (epoch, entry, nonce) => {
  const signer = await new BrowserProvider(window.ethereum).getSigner();
  const mining = new Contract(MiningAddress, MiningABI, signer);
  const tx = await mining.claim(epoch, entry.friend, entry.messageCount, entry.proof, nonce);
  await tx.wait();
  return tx.hash;
};
