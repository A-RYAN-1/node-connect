const address = {
  type: "string",
  pattern: "^0x[0-9a-fA-F]{40}$",
  example: "0xF830EF92A088256F2979A62bc7cefFe1F4b2c88A",
};

const errorResponse = (description) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
});

const message = {
  type: "object",
  required: ["id", "sender", "recipient", "ciphertext", "epoch", "createdAt"],
  properties: {
    id: { type: "integer", example: 12 },
    sender: { ...address, description: "Lowercase address of the sender" },
    recipient: { ...address, description: "Lowercase address of the recipient" },
    ciphertext: { type: "string", description: "Base64 text; the server never reads it" },
    epoch: { type: "integer", description: "Daily mining epoch the message belongs to" },
    createdAt: { type: "string", format: "date-time" },
  },
};

const wrappedKey = {
  type: "string",
  description: "The room key (and group name) boxed to one member; base64, the server cannot open it",
  example: "d3JhcHBlZC1rZXk=",
};

const groupKeyList = {
  type: "array",
  items: {
    type: "object",
    required: ["member", "wrapped"],
    properties: { member: address, wrapped: wrappedKey },
  },
};

const group = {
  type: "object",
  required: ["id", "owner", "version", "members"],
  properties: {
    id: { type: "integer", example: 3 },
    owner: address,
    version: { type: "integer", description: "Current key version; it grows when a member is removed", example: 1 },
    members: { type: "array", items: address },
    keys: {
      type: "array",
      description: "Your own wrapped keys, one per key version you hold (listing only)",
      items: {
        type: "object",
        properties: { version: { type: "integer" }, wrapped: wrappedKey },
      },
    },
  },
};

const groupMessage = {
  type: "object",
  required: ["id", "groupId", "sender", "version", "ciphertext", "createdAt"],
  properties: {
    id: { type: "integer" },
    groupId: { type: "integer" },
    sender: address,
    version: { type: "integer", description: "The key version the ciphertext was made with" },
    ciphertext: { type: "string", description: "Base64 secretbox text; the server never reads it" },
    createdAt: { type: "string", format: "date-time" },
  },
};

const jsonBody = (schema) => ({ required: true, content: { "application/json": { schema } } });
const jsonOk = (description, schema) => ({ description, content: { "application/json": { schema } } });

const spec = {
  openapi: "3.0.3",
  info: {
    title: "node-connect API",
    version: "1.0.0",
    description:
      "Sign in with an Ethereum wallet (EIP-4361) and exchange encrypted messages. " +
      "The server stores ciphertext only. Order: GET /api/auth/nonce, sign the message in " +
      "your wallet, POST /api/auth/verify, then use the session cookie.",
  },
  servers: [{ url: "/" }],
  tags: [
    { name: "auth", description: "Sign in with Ethereum" },
    { name: "messages", description: "Encrypted message store" },
    { name: "groups", description: "Group chats with a shared room key wrapped per member" },
    { name: "ops", description: "Health" },
  ],
  paths: {
    "/api/auth/nonce": {
      get: {
        tags: ["auth"],
        summary: "Issue a one-time sign-in nonce (valid 5 minutes)",
        responses: {
          200: {
            description: "A fresh nonce to put in the SIWE message",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["nonce"],
                  properties: { nonce: { type: "string", example: "b7Xq9m2LkP4tR8vA" } },
                },
              },
            },
          },
        },
      },
    },
    "/api/auth/verify": {
      post: {
        tags: ["auth"],
        summary: "Verify the signed SIWE message and start a session",
        description:
          "The message domain must be this site and its chain id the configured chain. " +
          "The nonce is consumed whether or not the signature is valid. " +
          "On success an httpOnly cookie is set.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["message", "signature"],
                properties: {
                  message: { type: "string", description: "The EIP-4361 message text" },
                  signature: { type: "string", description: "personal_sign signature, 0x hex" },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: "Signed in",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["address"],
                  properties: { address },
                },
              },
            },
          },
          400: errorResponse("Malformed message, wrong site or chain, or unknown/expired nonce"),
          401: errorResponse("Signature does not match the address"),
        },
      },
    },
    "/api/auth/session": {
      get: {
        tags: ["auth"],
        summary: "Who am I",
        responses: {
          200: {
            description: "The signed-in address",
            content: {
              "application/json": {
                schema: { type: "object", required: ["address"], properties: { address } },
              },
            },
          },
          401: errorResponse("Not signed in"),
        },
      },
    },
    "/api/auth/logout": {
      post: {
        tags: ["auth"],
        summary: "End the session",
        responses: {
          200: {
            description: "Cookie cleared",
            content: {
              "application/json": {
                schema: { type: "object", properties: { ok: { type: "boolean" } } },
              },
            },
          },
        },
      },
    },
    "/api/messages": {
      post: {
        tags: ["messages"],
        summary: "Store one encrypted message",
        description:
          "Rate limited to 30 messages per minute per sender. The ciphertext must be " +
          "base64 text (1 to 4096 characters), so plain sentences are rejected.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["recipient", "ciphertext"],
                properties: {
                  recipient: address,
                  ciphertext: { type: "string", example: "bm90LXJlYWwtY2lwaGVydGV4dA==" },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: "Stored",
            content: {
              "application/json": {
                schema: { type: "object", properties: { message } },
              },
            },
          },
          400: errorResponse("Invalid recipient or ciphertext"),
          401: errorResponse("Not signed in"),
          403: errorResponse("The recipient is not an accepted friend on the Registry contract"),
          429: errorResponse("Rate limit reached"),
          503: errorResponse("The friendship could not be read from the chain"),
        },
      },
      get: {
        tags: ["messages"],
        summary: "Read the thread between you and another address, newest first",
        parameters: [
          { name: "with", in: "query", required: true, schema: address },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
          },
          {
            name: "before",
            in: "query",
            description: "Return only messages with an id lower than this (paging)",
            schema: { type: "integer", minimum: 1 },
          },
        ],
        responses: {
          200: {
            description: "Messages, newest first",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { messages: { type: "array", items: message } },
                },
              },
            },
          },
          400: errorResponse("Invalid query"),
          401: errorResponse("Not signed in"),
        },
      },
    },
    "/api/groups": {
      post: {
        tags: ["groups"],
        summary: "Create a group; the owner sends one wrapped room key per member",
        description:
          "The owner makes the room key in the browser and wraps it with each member's public key from the Registry. " +
          "Every other member must be an accepted friend of the owner. 2 to 20 members, the owner included.",
        requestBody: jsonBody({ type: "object", required: ["keys"], properties: { keys: groupKeyList } }),
        responses: {
          201: jsonOk("Created", { type: "object", properties: { group } }),
          400: errorResponse("Invalid members or keys"),
          401: errorResponse("Not signed in"),
          403: errorResponse("A member is not the owner's accepted friend"),
        },
      },
      get: {
        tags: ["groups"],
        summary: "The groups you are in, with your own wrapped keys",
        responses: {
          200: jsonOk("Groups", { type: "object", properties: { groups: { type: "array", items: group } } }),
          401: errorResponse("Not signed in"),
        },
      },
    },
    "/api/groups/members": {
      post: {
        tags: ["groups"],
        summary: "Owner adds a member with a wrapped copy of the current room key",
        description: "The new member reads messages sent on the current key version, not older ones.",
        requestBody: jsonBody({
          type: "object",
          required: ["group", "member", "wrapped"],
          properties: { group: { type: "integer" }, member: address, wrapped: wrappedKey },
        }),
        responses: {
          201: jsonOk("Added", { type: "object", properties: { group } }),
          400: errorResponse("Already a member, group full or invalid input"),
          401: errorResponse("Not signed in"),
          403: errorResponse("Not the owner, or not the owner's friend"),
          404: errorResponse("No such group"),
          409: errorResponse("The group changed; reload it"),
        },
      },
      delete: {
        tags: ["groups"],
        summary: "Owner removes a member and moves the group to a new key version",
        description:
          "The body carries a fresh wrapped key of the new room key for exactly the remaining members, so the " +
          "removed member can read nothing sent from now on.",
        requestBody: jsonBody({
          type: "object",
          required: ["group", "member", "keys"],
          properties: { group: { type: "integer" }, member: address, keys: groupKeyList },
        }),
        responses: {
          200: jsonOk("Removed", { type: "object", properties: { group } }),
          400: errorResponse("The keys do not match the remaining members, or the owner was named"),
          401: errorResponse("Not signed in"),
          403: errorResponse("Not the owner"),
          404: errorResponse("No such group"),
          409: errorResponse("The group changed; reload it"),
        },
      },
    },
    "/api/groups/messages": {
      post: {
        tags: ["groups"],
        summary: "Store one group message encrypted with the current room key",
        description: "Counts toward the same per-minute limit as direct messages. A message on an older key version is refused with 409.",
        requestBody: jsonBody({
          type: "object",
          required: ["group", "version", "ciphertext"],
          properties: {
            group: { type: "integer" },
            version: { type: "integer", description: "The group's current key version" },
            ciphertext: { type: "string", example: "bm90LXJlYWwtY2lwaGVydGV4dA==" },
          },
        }),
        responses: {
          201: jsonOk("Stored", { type: "object", properties: { message: groupMessage } }),
          400: errorResponse("Invalid ciphertext"),
          401: errorResponse("Not signed in"),
          404: errorResponse("No such group, or you are not in it"),
          409: errorResponse("stale_key: the group moved to a newer key version"),
          429: errorResponse("Rate limit reached"),
        },
      },
      get: {
        tags: ["groups"],
        summary: "Read a group's messages, newest first",
        description: "Only messages made under key versions you hold are returned.",
        parameters: [
          { name: "group", in: "query", required: true, schema: { type: "integer" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
          { name: "before", in: "query", schema: { type: "integer", minimum: 1 } },
        ],
        responses: {
          200: jsonOk("Messages", { type: "object", properties: { messages: { type: "array", items: groupMessage } } }),
          400: errorResponse("Invalid query"),
          401: errorResponse("Not signed in"),
          404: errorResponse("No such group, or you are not in it"),
        },
      },
    },
    "/api/reads": {
      post: {
        tags: ["messages"],
        summary: "Mark a chat as read up to a message id",
        description: "Stores only the id of the last message you have seen in that chat; a mark never moves back. Send `with` (a friend's address) or `group`. The id must be a message you can see in that chat.",
        requestBody: jsonBody({
          type: "object",
          required: ["upTo"],
          properties: {
            with: address,
            group: { type: "integer" },
            upTo: { type: "integer", description: "Id of the newest message you have seen", example: 12 },
          },
        }),
        responses: {
          200: jsonOk("The mark after the update", { type: "object", properties: { lastRead: { type: "integer" } } }),
          400: errorResponse("Invalid body"),
          401: errorResponse("Not signed in"),
          404: errorResponse("No such message in that chat"),
        },
      },
      get: {
        tags: ["messages"],
        summary: "Unread counts for every chat, and a friend's read receipt",
        description: "Counts messages from others after your mark, per friend address and per group (only under key versions you hold). With `with`, also returns the newest of your messages that friend has read; it is read from that friend's own mark for your chat, so a third address learns nothing about it.",
        parameters: [{ name: "with", in: "query", schema: address }],
        responses: {
          200: jsonOk("Counts", {
            type: "object",
            properties: {
              unread: {
                type: "object",
                properties: {
                  direct: { type: "object", additionalProperties: { type: "integer" }, description: "Friend address to unread count" },
                  groups: { type: "object", additionalProperties: { type: "integer" }, description: "Group id to unread count" },
                },
              },
              theirLastRead: { type: "integer", description: "Only with `with`; 0 when they have not read anything" },
            },
          }),
          400: errorResponse("Invalid query"),
          401: errorResponse("Not signed in"),
        },
      },
    },
    "/api/mining/batch": {
      get: {
        tags: ["mining"],
        summary: "The leaves behind an epoch's anchored root, public so anyone can recompute it",
        description: "Senders the abuse score flags (send rate, reciprocity, recipients, account age; metadata only) have no leaves.",
        parameters: [
          {
            name: "epoch",
            in: "query",
            description: "A finished epoch (default: the one that just ended)",
            schema: { type: "integer", minimum: 0 },
          },
        ],
        responses: {
          200: {
            description: "Root and the (user, friend, messageCount) leaves in tree order",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    epoch: { type: "integer" },
                    root: { type: "string" },
                    leaves: { type: "array", items: { type: "array", items: { type: "string" } } },
                  },
                },
              },
            },
          },
          400: errorResponse("The epoch has not finished or is not a number"),
          404: errorResponse("No pair qualified in that epoch"),
        },
      },
    },
    "/api/mining/proof": {
      get: {
        tags: ["mining"],
        summary: "Your claims for a finished epoch, each with a Merkle proof for Mining.claim",
        parameters: [{ name: "epoch", in: "query", schema: { type: "integer", minimum: 0 } }],
        responses: {
          200: {
            description: "Claims (empty when none) and whether the root is on the chain yet",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    epoch: { type: "integer" },
                    root: { type: "string", nullable: true },
                    anchored: { type: "boolean" },
                    entries: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          friend: address,
                          messageCount: { type: "integer" },
                          proof: { type: "array", items: { type: "string" } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          400: errorResponse("The epoch has not finished or is not a number"),
          401: errorResponse("Not signed in"),
          503: errorResponse("The anchor could not be read from the chain"),
        },
      },
    },
    "/api/mining/anchor": {
      get: {
        tags: ["ops"],
        summary: "Scheduled job: posts the root of the epoch that just ended (needs the cron secret)",
        responses: {
          200: {
            description: "anchored, already_anchored or no_activity",
            content: {
              "application/json": {
                schema: { type: "object", properties: { epoch: { type: "integer" }, status: { type: "string" } } },
              },
            },
          },
          401: errorResponse("Missing or wrong cron secret"),
        },
      },
    },
    "/api/health": {
      get: {
        tags: ["ops"],
        summary: "Database reachability",
        responses: {
          200: {
            description: "Healthy",
            content: {
              "application/json": {
                schema: { type: "object", properties: { status: { type: "string" } } },
              },
            },
          },
          503: errorResponse("Database not reachable"),
        },
      },
    },
  },
  components: {
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: { code: { type: "string" }, message: { type: "string" } },
          },
        },
      },
    },
  },
};

module.exports = { spec };
