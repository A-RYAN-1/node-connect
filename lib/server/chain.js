const { JsonRpcProvider, Contract, Wallet } = require("ethers");

const ANCHOR_ABI = [
  "function rootOf(uint256 epoch) view returns (bytes32)",
  "function anchor(uint256 epoch, bytes32 root, string batchUri)",
];
const REGISTRY_ABI = ["function areFriends(address a, address b) view returns (bool)"];

// Reads friendships from the Registry contract. Only a positive answer is
// cached: a friendship can end at any time, but a stale yes lasts at most
// friendCacheSeconds, while a stale no would block a new friend.
function createChain(config, now = Date.now) {
  const registry = new Contract(
    config.registryAddress,
    REGISTRY_ABI,
    new JsonRpcProvider(config.rpcUrl, undefined, { staticNetwork: true })
  );
  const provider = new JsonRpcProvider(config.rpcUrl, undefined, { staticNetwork: true });
  const anchorRead = new Contract(config.anchorAddress, ANCHOR_ABI, provider);
  const confirmed = new Map();

  return {
    async rootOf(epoch) {
      return anchorRead.rootOf(epoch);
    },
    // Posts a root as the relayer and waits for it to be mined.
    async anchor(epoch, root, batchUri) {
      if (!config.relayerKey) throw new Error("RELAYER_PRIVATE_KEY is not set");
      const relayer = anchorRead.connect(new Wallet(config.relayerKey, provider));
      const tx = await relayer.anchor(epoch, root, batchUri);
      await tx.wait();
      return tx.hash;
    },
    async areFriends(a, b) {
      const key = [a, b].sort().join(":");
      const until = confirmed.get(key);
      if (until && until > now()) return true;
      const friends = await registry.areFriends(a, b);
      if (friends) confirmed.set(key, now() + config.friendCacheSeconds * 1000);
      else confirmed.delete(key);
      return friends;
    },
  };
}

module.exports = { createChain };
