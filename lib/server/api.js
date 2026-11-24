const { randomUUID } = require("crypto");
const { getIronSession } = require("iron-session");
const { SiweMessage, generateNonce } = require("siwe");
const { isAddress } = require("ethers");
const { timingSafeEqual } = require("crypto");
const { buildBatch, publish, entriesFor, MIN_MESSAGES } = require("./activity");
const { flaggedSenders } = require("./abuse");
const abuseModel = require("./abuseModel.json");
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
    const epochEnd = config.anchorGenesis + (epoch + 1) * config.epochSeconds;
    const flagged = flaggedSenders(await store.epochMessages(epoch), epochEnd, abuseModel);
    return buildBatch(await store.epochPairCounts(epoch), MIN_MESSAGES, flagged);
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
        await checkRate(session.address);
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

  // Group chats. The owner makes the room key in the browser and wraps it for
  // each member with their public key; the server stores the wrapped copies
  // and ciphertext and never sees a key or a name.
  function wrappedText(value, what) {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > config.maxWrappedChars ||
      !BASE64_TEXT.test(value)
    ) {
      throw badRequest(`${what} must be base64 text of 1 to ${config.maxWrappedChars} characters`);
    }
    return value;
  }

  function keyList(list, what) {
    if (!Array.isArray(list)) throw badRequest(`${what} must be a list of { member, wrapped }`);
    const seen = new Set();
    return list.map((entry) => {
      if (!entry || typeof entry.member !== "string" || !isAddress(entry.member)) {
        throw badRequest("Every member must be an Ethereum address");
      }
      const member = entry.member.toLowerCase();
      if (seen.has(member)) throw badRequest("A member is listed twice");
      seen.add(member);
      return { member, wrapped: wrappedText(entry.wrapped, "wrapped") };
    });
  }

  function groupId(value) {
    const id = Number(value);
    if (!Number.isInteger(id) || id < 1) throw badRequest("group must be a positive whole number");
    return id;
  }

  async function friendOf(owner, member) {
    let friends;
    try {
      friends = await chain.areFriends(owner, member);
    } catch {
      throw new ApiError(503, "chain_unavailable", "Could not check the friendship on the chain; try again");
    }
    if (!friends) throw forbidden(`${member} is not your accepted friend`);
  }

  async function ownedGroup(id, session) {
    const group = await store.getGroup(id);
    if (!group || !group.members.includes(session.address)) throw new ApiError(404, "not_found", "No such group");
    if (group.owner !== session.address) throw forbidden("Only the owner can change the members");
    return group;
  }

  async function checkRate(sender) {
    const recent =
      (await store.countRecentFrom(sender, 60)) + (await store.countRecentGroupFrom(sender, 60));
    if (recent >= config.messagesPerMinute) {
      throw tooMany(`At most ${config.messagesPerMinute} messages per minute`);
    }
  }

  const groups = wrap({
    POST: {
      auth: true,
      run: async ({ body, session }) => {
        const keys = keyList(body.keys, "keys");
        if (keys.length < 2 || keys.length > config.maxGroupMembers) {
          throw badRequest(`A group has 2 to ${config.maxGroupMembers} members, the owner included`);
        }
        if (!keys.some((k) => k.member === session.address)) {
          throw badRequest("The owner must hold a key too");
        }
        for (const k of keys) if (k.member !== session.address) await friendOf(session.address, k.member);
        const id = await store.createGroup({ owner: session.address, keys });
        return { status: 201, body: { group: { id, owner: session.address, version: 1, members: keys.map((k) => k.member) } } };
      },
    },
    GET: {
      auth: true,
      run: async ({ session }) => ({ body: { groups: await store.groupsFor(session.address) } }),
    },
  });

  const groupMembers = wrap({
    POST: {
      auth: true,
      run: async ({ body, session }) => {
        const group = await ownedGroup(groupId(body.group), session);
        const [entry] = keyList([{ member: body.member, wrapped: body.wrapped }], "member");
        if (group.members.includes(entry.member)) throw badRequest("Already a member");
        if (group.members.length >= config.maxGroupMembers) {
          throw badRequest(`A group has at most ${config.maxGroupMembers} members`);
        }
        await friendOf(session.address, entry.member);
        const added = await store.addGroupMember(group.id, group.version, entry.member, entry.wrapped);
        if (!added) throw new ApiError(409, "stale_key", "The group changed; reload it and try again");
        return { status: 201, body: { group: { id: group.id, version: group.version, members: [...group.members, entry.member] } } };
      },
    },
    // Removing a member moves the group to a new key version. The request carries a
    // fresh wrapped copy for every remaining member, so the removed one cannot read
    // anything sent from now on.
    DELETE: {
      auth: true,
      run: async ({ body, session }) => {
        const group = await ownedGroup(groupId(body.group), session);
        if (typeof body.member !== "string" || !isAddress(body.member)) {
          throw badRequest("member must be an Ethereum address");
        }
        const removed = body.member.toLowerCase();
        if (removed === group.owner) throw badRequest("The owner cannot be removed");
        if (!group.members.includes(removed)) throw badRequest("Not a member");
        const keys = keyList(body.keys, "keys");
        const remaining = group.members.filter((m) => m !== removed).sort();
        if (JSON.stringify(keys.map((k) => k.member).sort()) !== JSON.stringify(remaining)) {
          throw badRequest("keys must hold exactly one wrapped key for each remaining member");
        }
        const done = await store.rekeyGroup(group.id, group.version, keys);
        if (!done) throw new ApiError(409, "stale_key", "The group changed; reload it and try again");
        return { body: { group: { id: group.id, version: group.version + 1, members: remaining } } };
      },
    },
  });

  const groupMessages = wrap({
    POST: {
      auth: true,
      run: async ({ body, session }) => {
        const id = groupId(body.group);
        const group = await store.getGroup(id);
        if (!group || !group.members.includes(session.address)) throw new ApiError(404, "not_found", "No such group");
        if (
          typeof body.ciphertext !== "string" ||
          body.ciphertext.length === 0 ||
          body.ciphertext.length > config.maxCiphertextChars ||
          !BASE64_TEXT.test(body.ciphertext)
        ) {
          throw badRequest(`ciphertext must be base64 text of 1 to ${config.maxCiphertextChars} characters`);
        }
        if (!Number.isInteger(body.version) || body.version !== group.version) {
          throw new ApiError(409, "stale_key", `The group is on key version ${group.version}; reload it`);
        }
        await checkRate(session.address);
        const row = await store.insertGroupMessage({
          groupId: id,
          sender: session.address,
          version: body.version,
          ciphertext: body.ciphertext,
        });
        if (!row) throw new ApiError(409, "stale_key", "The group changed; reload it and try again");
        return { status: 201, body: { message: row } };
      },
    },
    GET: {
      auth: true,
      run: async ({ query, session }) => {
        const id = groupId(query.group);
        const group = await store.getGroup(id);
        if (!group || !group.members.includes(session.address)) throw new ApiError(404, "not_found", "No such group");
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
        return { body: { messages: await store.listGroupMessages(id, session.address, limit, before) } };
      },
    },
  });

  // Read marks: the id of the last message you have seen in a chat. Metadata only.
  const reads = wrap({
    POST: {
      auth: true,
      run: async ({ body, session }) => {
        const upTo = Number(body.upTo);
        if (!Number.isInteger(upTo) || upTo < 1) throw badRequest("upTo must be a positive message id");
        let lastRead;
        if (body.group !== undefined) {
          lastRead = await store.markGroupRead(session.address, groupId(body.group), upTo);
        } else {
          if (typeof body.with !== "string" || !isAddress(body.with)) {
            throw badRequest("Send with (an Ethereum address) or group");
          }
          lastRead = await store.markDirectRead(session.address, body.with.toLowerCase(), upTo);
        }
        if (lastRead === null) throw new ApiError(404, "not_found", "No such message in that chat");
        return { body: { lastRead } };
      },
    },
    // Your unread counts per chat; with ?with=<address> also how far that friend has read your messages.
    GET: {
      auth: true,
      run: async ({ query, session }) => {
        const body = { unread: await store.unreadCounts(session.address) };
        if (query.with !== undefined) {
          if (typeof query.with !== "string" || !isAddress(query.with)) throw badRequest("with must be an Ethereum address");
          body.theirLastRead = await store.readMark(query.with.toLowerCase(), session.address);
        }
        return { body };
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

  return { groups, groupMembers, groupMessages, reads, nonce, verify, miningBatch, miningProof, miningAnchor, session: sessionRoute, logout, messages, health };
}

module.exports = { createApi };
