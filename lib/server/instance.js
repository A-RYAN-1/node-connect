const { createApi } = require("./api");
const { createNeonStore } = require("./neonStore");
const { readConfig, requireSecrets } = require("./config");

let api;

function getApi() {
  if (!api) {
    const config = readConfig();
    requireSecrets(config);
    if (!config.databaseUrl) throw new Error("DATABASE_URL is not set");
    api = createApi({ config, store: createNeonStore(config.databaseUrl) });
  }
  return api;
}

function lazy(name) {
  return (req, res) => getApi()[name](req, res);
}

module.exports = { lazy };
