const http = require("http");
const { Wallet } = require("ethers");
const { SiweMessage } = require("siwe");
const { createApi } = require("../lib/server/api");
const { readConfig } = require("../lib/server/config");
const { createMemoryStore } = require("../lib/server/memoryStore");
const { createNeonStore } = require("../lib/server/neonStore");

const DOMAIN = "localhost:3000";

function routes(api) {
  return {
    "/api/auth/nonce": api.nonce,
    "/api/auth/verify": api.verify,
    "/api/auth/session": api.session,
    "/api/auth/logout": api.logout,
    "/api/messages": api.messages,
    "/api/health": api.health,
  };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text || !String(req.headers["content-type"]).startsWith("application/json")) return undefined;
  return JSON.parse(text);
}

async function startServer(overrides = {}) {
  const useNeon = process.env.STORE === "neon";
  const store = useNeon
    ? createNeonStore(process.env.DATABASE_URL)
    : createMemoryStore(overrides.now);
  const config = {
    ...readConfig({}),
    sessionSecret: "x".repeat(40),
    allowedDomains: [DOMAIN],
    ...overrides.config,
  };
  const api = createApi({ config, store, now: overrides.now, log: () => {} });
  const table = routes(api);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    };
    req.query = Object.fromEntries(url.searchParams);
    req.body = await readJson(req);
    const handler = table[url.pathname];
    if (!handler) {
      res.statusCode = 404;
      return res.end();
    }
    await handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    base,
    config,
    store,
    useNeon,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function client(base) {
  let cookie = "";
  return {
    async call(method, path, body, headers = {}) {
      const res = await fetch(base + path, {
        method,
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0];
      const text = await res.text();
      return {
        status: res.status,
        headers: res.headers,
        setCookie: set,
        json: text ? JSON.parse(text) : null,
      };
    },
  };
}

function siweText({ wallet, nonce, domain = DOMAIN, chainId = 560048 }) {
  return new SiweMessage({
    domain,
    address: wallet.address,
    statement: "Sign in to node-connect",
    uri: `http://${domain}`,
    version: "1",
    chainId,
    nonce,
  }).prepareMessage();
}

async function signIn(c, wallet, options = {}) {
  const { json } = await c.call("GET", "/api/auth/nonce");
  const message = siweText({ wallet, nonce: json.nonce, ...options });
  const signature = await (options.signer || wallet).signMessage(message);
  return c.call("POST", "/api/auth/verify", { message, signature });
}

const newWallet = () => Wallet.createRandom();

module.exports = { startServer, client, siweText, signIn, newWallet, DOMAIN };
