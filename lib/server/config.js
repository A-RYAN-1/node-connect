const hoodi = require("../../deployments/hoodi.json");

const DAY_SECONDS = 86400;

function readConfig(env = process.env) {
  return {
    sessionSecret: env.SESSION_SECRET || "",
    databaseUrl: env.DATABASE_URL || "",
    chainId: Number(env.SIWE_CHAIN_ID || hoodi.chainId),
    allowedDomains: (env.SIWE_ALLOWED_DOMAINS || "")
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean),
    anchorGenesis: Number(env.ANCHOR_GENESIS || hoodi.anchorGenesis),
    epochSeconds: DAY_SECONDS,
    nonceTtlSeconds: 300,
    sessionTtlSeconds: 7 * DAY_SECONDS,
    messagesPerMinute: Number(env.MESSAGES_PER_MINUTE || 30),
    maxCiphertextChars: 4096,
    production: env.NODE_ENV === "production",
  };
}

function requireSecrets(config) {
  if (config.sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters");
  }
  if (config.production && config.allowedDomains.length === 0) {
    throw new Error("SIWE_ALLOWED_DOMAINS must list the site host in production");
  }
}

module.exports = { readConfig, requireSecrets };
