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
