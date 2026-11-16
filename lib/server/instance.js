const { createApi } = require("./api");
const { createNeonStore } = require("./neonStore");
const { createMemoryStore } = require("./memoryStore");
const { createChain } = require("./chain");
const { readConfig, requireSecrets } = require("./config");

let api;

function getApi() {
  if (!api) {
    const config = readConfig();
    requireSecrets(config);
    if (!config.databaseUrl) throw new Error("DATABASE_URL is not set");
    // DATABASE_URL=memory is for the browser test only: rows vanish on restart.
    const store = config.databaseUrl === "memory" ? createMemoryStore() : createNeonStore(config.databaseUrl);
    api = createApi({ config, store, chain: createChain(config) });
  }
  return api;
}

function lazy(name) {
  return (req, res) => getApi()[name](req, res);
}

module.exports = { lazy };
