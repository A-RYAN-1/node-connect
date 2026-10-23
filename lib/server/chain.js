const { JsonRpcProvider, Contract } = require("ethers");

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
  const confirmed = new Map();

  return {
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
