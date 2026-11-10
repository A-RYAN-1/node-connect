const { randomUUID } = require("crypto");
const { getIronSession } = require("iron-session");
const { SiweMessage, generateNonce } = require("siwe");
const { isAddress } = require("ethers");
const { timingSafeEqual } = require("crypto");
const { buildBatch, publish, entriesFor } = require("./activity");
const { ApiError, badRequest, unauthorized, forbidden, tooMany } = require("./errors");

const BASE64_TEXT = /^[A-Za-z0-9+/_-]+={0,2}$/;

function allowedDomains(config) {
  if (config.allowedDomains.length) return config.allowedDomains;
  return config.production ? [] : ["localhost:3000"];
}

function createApi({ config, store, chain, now = Date.now, log = console.log }) {
  const sessionOptions = {
    password: config.sessionSecret,
    cookieName: "nc_session",
    ttl: config.sessionTtlSeconds,
    cookieOptions: {
      httpOnly: true,
      secure: config.production,
      sameSite: "lax",
      path: "/",
    },
  };

  const epochNow = () =>
    Math.max(0, Math.floor((now() / 1000 - config.anchorGenesis) / config.epochSeconds));

  // The scheduled job sends "Authorization: Bearer <CRON_SECRET>".
  function requireCron(req) {
    const given = Buffer.from(String(req.headers.authorization || ""));
    const wanted = Buffer.from(`Bearer ${config.cronSecret}`);
    if (!config.cronSecret || given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
      throw unauthorized("Missing or wrong cron secret");
    }
  }

  // A finished epoch number from the query; defaults to the one just ended.
  function finishedEpoch(query) {
    const current = epochNow();
    const epoch = query.epoch === undefined ? current - 1 : Number(query.epoch);
    if (!Number.isInteger(epoch) || epoch < 0) throw badRequest("epoch must be a whole number");
    if (epoch >= current) throw badRequest(`Epoch ${epoch} has not finished (current is ${current})`);
    return epoch;
  }

  async function batchOf(epoch) {
    return buildBatch(await store.epochPairCounts(epoch));
  }

  function wrap(methods) {
    const allow = Object.keys(methods).join(", ");
    return async (req, res) => {
      const requestId = randomUUID();
      const started = now();
      res.setHeader("x-request-id", requestId);
      res.setHeader("cache-control", "no-store");
      let status = 500;
      try {
        const spec = methods[req.method];
        if (!spec) {
          res.setHeader("allow", allow);
          throw new ApiError(405, "method_not_allowed", `Use ${allow}`);
        }
        if (req.method === "POST") {
          const type = String(req.headers["content-type"] || "");
          if (!type.startsWith("application/json")) {
            throw new ApiError(415, "unsupported_media_type", "Send application/json");
          }
        }
        if (spec.cron) requireCron(req);
        const session = await getIronSession(req, res, sessionOptions);
        if (spec.auth && !session.address) throw unauthorized();
        const out = await spec.run({
          session,
          body: req.body && typeof req.body === "object" ? req.body : {},
          query: req.query || {},
        });
        status = out.status || 200;
        res.status(status).json(out.body);
      } catch (err) {
        if (err instanceof ApiError) {
          status = err.status;
          res.status(status).json({ error: { code: err.code, message: err.message } });
        } else {
          log(JSON.stringify({ level: "error", requestId, message: String(err && err.message) }));
          status = 500;
          res.status(500).json({ error: { code: "internal", message: "Something went wrong" } });
        }
      } finally {
        log(
          JSON.stringify({
            level: "info",
            requestId,
            method: req.method,
            path: String(req.url || "").split("?")[0],
            status,
            ms: now() - started,
          })
        );
      }
    };
  }

  const nonce = wrap({
    GET: {
      run: async () => {
        const value = generateNonce();
        await store.createNonce(value, config.nonceTtlSeconds);
        return { body: { nonce: value } };
      },
    },
  });

  const verify = wrap({
    POST: {
      run: async ({ body, session }) => {
        const { message, signature } = body;
        if (typeof message !== "string" || typeof signature !== "string") {
          throw badRequest("message and signature are required");
        }
        let siwe;
        try {
          siwe = new SiweMessage(message);
        } catch {
          throw badRequest("The sign-in message is not valid EIP-4361");
        }
        if (!allowedDomains(config).includes(siwe.domain)) {
          throw badRequest("The sign-in message is for a different site");
        }
        if (siwe.chainId !== config.chainId) {
          throw badRequest(`The sign-in message must use chain ${config.chainId}`);
        }
        if (!(await store.consumeNonce(siwe.nonce))) {
          throw badRequest("The nonce is unknown, used or expired; request a new one");
        }
        try {
          await siwe.verify({ signature, domain: siwe.domain, nonce: siwe.nonce });
        } catch {
          throw unauthorized("The signature does not match the address");
        }
        session.address = siwe.address.toLowerCase();
        await session.save();
        return { body: { address: session.address } };
      },
    },
  });

  const sessionRoute = wrap({
    GET: { auth: true, run: async ({ session }) => ({ body: { address: session.address } }) },
  });

  const logout = wrap({
    POST: {
      run: async ({ session }) => {
        session.destroy();
        return { body: { ok: true } };
      },
    },
  });

  const messages = wrap({
    POST: {
      auth: true,
      run: async ({ body, session }) => {
        const { recipient, ciphertext } = body;
        if (typeof recipient !== "string" || !isAddress(recipient)) {
          throw badRequest("recipient must be an Ethereum address");
        }
        const to = recipient.toLowerCase();
        if (to === session.address) throw badRequest("You cannot message yourself");
        if (
          typeof ciphertext !== "string" ||
          ciphertext.length === 0 ||
          ciphertext.length > config.maxCiphertextChars ||
          !BASE64_TEXT.test(ciphertext)
        ) {
          throw badRequest(
            `ciphertext must be base64 text of 1 to ${config.maxCiphertextChars} characters`
          );
        }
        let friends;
        try {
          friends = await chain.areFriends(session.address, to);
        } catch {
          throw new ApiError(503, "chain_unavailable", "Could not check the friendship on the chain; try again");
        }
        if (!friends) throw forbidden("You can only message accepted friends");
        const recent = await store.countRecentFrom(session.address, 60);
        if (recent >= config.messagesPerMinute) {
          throw tooMany(`At most ${config.messagesPerMinute} messages per minute`);
        }
        const elapsed = Math.floor((now() / 1000 - config.anchorGenesis) / config.epochSeconds);
        const row = await store.insertMessage({
          sender: session.address,
          recipient: to,
          ciphertext,
          epoch: Math.max(0, elapsed),
        });
        return { status: 201, body: { message: row } };
      },
    },
    GET: {
      auth: true,
      run: async ({ query, session }) => {
        const other = query.with;
        if (typeof other !== "string" || !isAddress(other)) {
          throw badRequest("with must be an Ethereum address");
        }
        const limit = query.limit === undefined ? 50 : Number(query.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          throw badRequest("limit must be an integer from 1 to 100");
        }
        let before = null;
        if (query.before !== undefined) {
          before = Number(query.before);
          if (!Number.isInteger(before) || before < 1) {
            throw badRequest("before must be a positive message id");
          }
        }
        const rows = await store.listThread(session.address, other.toLowerCase(), limit, before);
        return { body: { messages: rows } };
      },
    },
  });

  const health = wrap({
    GET: {
      run: async () => {
        try {
          await store.ping();
        } catch {
          throw new ApiError(503, "unavailable", "Database is not reachable");
        }
        return { body: { status: "ok" } };
      },
    },
  });

  // Public: the leaves behind an epoch's root, so anyone can recompute it.
  const miningBatch = wrap({
    GET: {
      run: async ({ query }) => {
        const epoch = finishedEpoch(query);
        const batch = await batchOf(epoch);
        if (!batch) throw new ApiError(404, "no_activity", `Epoch ${epoch} has no qualifying activity`);
        return { body: publish(epoch, batch) };
      },
    },
  });

  // The signed-in user's claims for an epoch, with Merkle proofs.
  const miningProof = wrap({
    GET: {
      auth: true,
      run: async ({ query, session }) => {
        const epoch = finishedEpoch(query);
        const batch = await batchOf(epoch);
        let anchored = false;
        try {
          const root = await chain.rootOf(epoch);
          anchored = /[1-9a-f]/i.test(String(root).slice(2));
        } catch {
          throw new ApiError(503, "chain_unavailable", "Could not read the anchor; try again");
        }
        return {
          body: {
            epoch,
            root: batch ? batch.tree.root : null,
            anchored,
            entries: batch ? entriesFor(batch, session.address) : [],
          },
        };
      },
    },
  });

  // Scheduled daily: posts the root of the epoch that just ended.
  const miningAnchor = wrap({
    GET: {
      cron: true,
      run: async ({ query }) => {
        const epoch = finishedEpoch(query);
        const batch = await batchOf(epoch);
        if (!batch) return { body: { epoch, status: "no_activity" } };
        let existing;
        try {
          existing = await chain.rootOf(epoch);
        } catch {
          throw new ApiError(503, "chain_unavailable", "Could not read the anchor; try again");
        }
        if (/[1-9a-f]/i.test(String(existing).slice(2))) {
          return { body: { epoch, status: "already_anchored" } };
        }
        const uri = `${config.batchBaseUrl}/api/mining/batch?epoch=${epoch}`;
        const tx = await chain.anchor(epoch, batch.tree.root, uri);
        return { body: { epoch, status: "anchored", root: batch.tree.root, tx } };
      },
    },
  });

  return { nonce, verify, miningBatch, miningProof, miningAnchor, session: sessionRoute, logout, messages, health };
}

module.exports = { createApi };
