// The only place the frontend reads environment variables. Next.js inlines
// NEXT_PUBLIC_ values at build time, so each one is referenced literally.
import { networks } from "./networks";

const required = (name, value) => {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env and set it.`
    );
  }
  return value.trim();
};

const address = (name, value) => {
  const text = required(name, value);
  if (!/^0x[0-9a-fA-F]{40}$/.test(text)) {
    throw new Error(`${name} is not an address: ${text}`);
  }
  return text;
};

export const REGISTRY_ADDRESS = address(
  "NEXT_PUBLIC_REGISTRY_ADDRESS",
  process.env.NEXT_PUBLIC_REGISTRY_ADDRESS
);

export const TOKEN_ADDRESS = address(
  "NEXT_PUBLIC_TOKEN_ADDRESS",
  process.env.NEXT_PUBLIC_TOKEN_ADDRESS
);

// Block the Registry was deployed in: where reading its events starts.
export const REGISTRY_START_BLOCK = Number(
  required(
    "NEXT_PUBLIC_REGISTRY_START_BLOCK",
    process.env.NEXT_PUBLIC_REGISTRY_START_BLOCK
  )
);

export const NETWORK_NAME = required(
  "NEXT_PUBLIC_NETWORK",
  process.env.NEXT_PUBLIC_NETWORK
);

if (!networks[NETWORK_NAME]) {
  throw new Error(
    `NEXT_PUBLIC_NETWORK must be one of: ${Object.keys(networks).join(", ")}`
  );
}

if (!Number.isInteger(REGISTRY_START_BLOCK) || REGISTRY_START_BLOCK < 0) {
  throw new Error("NEXT_PUBLIC_REGISTRY_START_BLOCK must be a block number");
}

export const NETWORK = networks[NETWORK_NAME];
