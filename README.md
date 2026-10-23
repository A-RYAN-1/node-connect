<p align="center">
  <img src="docs/images/logo.svg" width="88" alt="Node Connect logo">
</p>

<h1 align="center">Node Connect</h1>

<p align="center">
  An end-to-end encrypted chat where your wallet is your account.<br>
  Sign in with MetaMask, befriend people on chain and chat; messages are encrypted in your browser and the server only ever stores ciphertext.
</p>

<p align="center">
  <a href="https://node-connect-sigma.vercel.app"><strong>Live demo</strong></a>
  &middot;
  <a href="#try-it-live">Try it</a>
  &middot;
  <a href="#how-it-works">How it works</a>
  &middot;
  <a href="#run-it-locally">Run locally</a>
  &middot;
  <a href="contracts/Registry.sol">The registry contract</a>
</p>

<p align="center">
  <a href="https://github.com/A-RYAN-1/node-connect/actions/workflows/ci.yml"><img src="https://github.com/A-RYAN-1/node-connect/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/A-RYAN-1/node-connect/actions/workflows/uptime.yml"><img src="https://github.com/A-RYAN-1/node-connect/actions/workflows/uptime.yml/badge.svg" alt="Uptime"></a>
  <img src="https://img.shields.io/badge/Solidity-0.8.19-363636?logo=solidity&logoColor=white" alt="Solidity 0.8.19">
  <img src="https://img.shields.io/badge/Hardhat-2-FFF100?logo=hardhat&logoColor=black" alt="Hardhat 2">
  <img src="https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white" alt="Next.js 16">
  <img src="https://img.shields.io/badge/ethers-6-2535A0?logo=ethereum&logoColor=white" alt="ethers 6">
  <img src="https://img.shields.io/badge/network-Hoodi%20testnet-627EEA?logo=ethereum&logoColor=white" alt="Hoodi testnet">
  <img src="https://img.shields.io/badge/hosted%20on-Vercel-000000?logo=vercel&logoColor=white" alt="Hosted on Vercel">
</p>

<p align="center">
  <a href="https://node-connect-sigma.vercel.app">
    <img src="docs/images/chat.png" width="90%" alt="Chat screen: friends list on the left, the chat with bob on the right, the account name and an 11 TOK balance in the header">
  </a>
</p>

<p align="center"><sub>Last updated: 2026-10-23 &middot; Live on Vercel (free), contracts on the Hoodi testnet &middot; rework in progress (see <a href="#status-and-roadmap">roadmap</a>)</sub></p>

---

## Contents

- [About](#about)
- [Try it live](#try-it-live)
- [Features](#features)
- [Why it exists](#why-it-exists)
- [How it works](#how-it-works)
- [Engineering quality](#engineering-quality)
- [Run it locally](#run-it-locally)
- [Environment variables](#environment-variables)
- [Deployment](#deployment)
- [Status and roadmap](#status-and-roadmap)
- [Credits](#credits)

## About

Most chat apps keep your account and your messages on a company's servers. Node Connect keeps your
identity and friendships in a smart contract instead: your wallet address is your account, a
friendship needs a request and an acceptance recorded on chain, and the public key that encrypts
messages to you is published there. The messages themselves travel through a small backend (Vercel
Functions and a Neon database) that stores only ciphertext. The key is derived in your browser from
one wallet signature, so the server, the database and the chain never see a message in the clear.

Rewards are being rebuilt as a real ERC-20 token (TOK) with limits per day. The token contract is
deployed and the leaderboard reads balances from it, but mining is not wired into the site yet, so
every balance is zero for now.

## Try it live

Open **https://node-connect-sigma.vercel.app** in a browser with the
[MetaMask](https://metamask.io) extension. Creating an account and answering friend requests are
transactions on the Hoodi testnet, so the account needs a little Hoodi ETH, which is free from a
faucet such as the
[Google Cloud faucet](https://cloud.google.com/application/web3/faucet/ethereum/hoodi) or the
[PoW faucet](https://hoodi-faucet.pk910.de/). Sending and reading messages costs no gas.

Things to try in the first two minutes (use two MetaMask accounts, one per browser profile):

1. **Connect wallet** and approve the network switch: the app adds Hoodi to MetaMask if it is missing.
2. **Create an account** with a username: MetaMask asks you to sign a text that creates your chat
   key, then to confirm one transaction that stores your name and public key.
3. Open **Find people** and send a request; the other account sees it there and accepts.
4. Open the chat, choose **Unlock messages** (two signatures, no gas) and send a message: it shows
   as sending, then lands in the thread. The other side sees it within a few seconds.
5. Open the **Leaderboard** to see everyone and their TOK balance.

<table>
  <tr>
    <td width="50%"><img src="docs/images/find-friends.png" alt="Find people page: dave and erin, each with an Add friend button"><p align="center"><sub>Registered users you can add, read from the contract (<a href="#the-contract">how friendships work</a>)</sub></p></td>
    <td width="50%"><img src="docs/images/leaderboard.png" alt="Leaderboard: alice 11, bob 10, carol 6, dave 5, erin 5 tokens"><p align="center"><sub>Everyone ranked by tokens (<a href="#the-contract">the reward rules</a>)</sub></p></td>
  </tr>
</table>

<sub>Screenshots: the production build of this commit on a local Hardhat chain seeded with demo
accounts (alice, bob, carol, dave, erin), 1440x900, 2026-10-21. The live site shows the same
screens for Hoodi accounts.</sub>

## Features

- **Wallet sign-in**: MetaMask connects the account; the app switches MetaMask to the configured
  network and adds it when missing. The API uses Sign-In with Ethereum (EIP-4361) and an httpOnly cookie.
- **On-chain profiles and friendships**: a username and an encryption public key per address in the
  `Registry` contract; a friendship needs a request and an acceptance, and can be declined, removed
  or blocked.
- **End-to-end encrypted chat**: X25519 keys come from one wallet signature, messages are sealed in
  the browser (NaCl box) and the server stores base64 ciphertext only. The API accepts a message only
  between accepted friends, checked on chain.
- **Pending and failed states**: a message shows at once as sending; if the API refuses it, it stays
  in the thread as not sent with Retry and Discard.
- **Live thread**: the open conversation polls every 4 seconds while the tab is visible.
- **Leaderboard** of every user by TOK balance (mining arrives in a later release).
- **Messages API**: documented at `/api/docs` (OpenAPI 3 and Swagger UI).
- **Local chain mode**: the same app runs against a Hardhat node with test accounts.

## Why it exists

It started as a final-year project to learn how a dApp is built end to end: a Solidity contract, its
tests, a deploy to a public testnet and a frontend that talks to it through a wallet. Bringing it up
to date in 2026 (Next.js 16, ethers 6, Hoodi after Holesky was retired, CI) taught the rest: a leaked
deployer key does not stop mattering when the file is deleted, and putting everything on chain makes
every click cost a wallet confirmation and every message public.

## How it works

```mermaid
flowchart LR
    U["Browser + MetaMask<br/>keys, encrypt, decrypt"] --> V
    subgraph Vercel["Vercel (free)"]
        V["Prerendered Next.js pages"]
        F["Vercel Functions<br/>/api: SIWE sign-in, messages"]
    end
    F --> N[("Neon Postgres<br/>nonces, ciphertext only")]
    F -- "areFriends (eth_call)" --> R
    U -- "reads, and signed transactions<br/>for register and friend requests" --> R["Public Hoodi RPC node"]
    R --> C[("Registry, NodeToken<br/>Hoodi testnet")]
```

What happens when you send a message:

```mermaid
sequenceDiagram
    actor A as You
    participant UI as Chat (ChatAppContext)
    participant API as /api/messages
    participant C as Registry (chain)
    participant D as Neon
    A->>UI: type a message, press Enter
    UI->>UI: seal with your secret key and the friend public key
    UI-->>A: bubble shown as sending
    UI->>API: POST recipient, ciphertext (session cookie)
    API->>C: areFriends(you, friend)
    C-->>API: true
    API->>D: store ciphertext
    API-->>UI: 201
    UI->>API: GET thread (every 4 s)
    UI-->>A: opened in the browser, bubble settles
```

Your secret key is never sent anywhere: it is the hash of the signature MetaMask returns for a fixed
text (`lib/client/crypto.js`), so the same wallet rebuilds the same key pair in any browser, and the
public half is written to the `Registry` when you create your account. A message is
`base64(nonce + box)`; the sender and the recipient can both open it, nobody else can.

### The legacy contract

[`contracts/ChatApp.sol`](contracts/ChatApp.sol) was the whole backend of the first version. The site no longer uses it; it stays deployed, verified and tested for reference.

| Call | Who can call it | Effect | Tokens |
|---|---|---|---|
| `createAccount(name)` | an address without an account; the name must not be empty | stores the username | +5 to you |
| `addFriend(address, name)` | a registered user, for another registered user who is not already a friend and not themselves | adds the friendship to both lists | +1 to both |
| `sendMessage(friend, text)` | friends only | appends to the chat keyed by the hash of both addresses | +1 to both |
| `readMessage(friend)` | anyone (`eth_call`) | returns the chat, oldest first | - |
| `getAllAppUser()`, `getMyFriendList()`, `getUsername(address)` | anyone (`eth_call`) | read accounts and friends | - |
| `mineMessageSafe(friend, nonce)` | anyone | +1 when `keccak(chat, last message, nonce)` is below a fixed target; not used by the UI | +1 to the caller |

Tokens are a balance kept inside the contract (`minerReward`), not an ERC-20 token, so they do not
show up in a wallet.

### The contracts the site uses (deployed on Hoodi 2026-10-18)

Four contracts replaced `ChatApp.sol`. The site uses `Registry` (profiles, keys, friendships) and
`NodeToken` (balances) since 2026-10-23; `ChatAnchor` and `Mining` wait for the mining release. All
source is verified on Blockscout.

| Contract | Address | What it does |
|---|---|---|
| `NodeToken` (TOK) | [`0xC6a2...09b0`](https://eth-hoodi.blockscout.com/address/0xC6a2fbCB19E29371a35Bf721559902843F6e09b0) | ERC-20, hard cap of 21M, minted only by `Mining`, no admin |
| `Registry` | [`0x6c03...1802`](https://eth-hoodi.blockscout.com/address/0x6c03e1B8273F0Dd3A6d4d7E28B21d15Ad9e71802) | profiles with an encryption key; friend request, accept, decline, remove, block |
| `ChatAnchor` | [`0x7604...f4cF`](https://eth-hoodi.blockscout.com/address/0x7604755AeA3D48b90F6b585bCD8333AF7Dbff4cF) | daily epochs; the relayer posts one Merkle root of activity per finished epoch |
| `Mining` | [`0xcB3e...661f`](https://eth-hoodi.blockscout.com/address/0xcB3e522516E30436358D0622874BE358C0ea661f) | claim TOK with a Merkle proof of activity plus a proof-of-work nonce |

Mining rules: at least 5 messages to one accepted friend in the epoch; the nonce hash covers the
caller, so nobody can reuse another's work; one claim per user per epoch and at most 100 per epoch;
accounts must be a day old; 50 TOK per claim, halved every 90 epochs; the target retargets from the
previous epoch's claims (aim: 10) within a factor of 16; only the epoch just ended is claimable;
every failure reverts. Deployer and relayer are separate wallets (addresses in
[`deployments/hoodi.json`](deployments/hoodi.json)); the relayer is trusted to post true roots
until the batch is published for recomputation (iteration 2).

### Tech stack

| Layer | Technology |
|---|---|
| Smart contract | Solidity 0.8.19, Hardhat 2 (compile, local node, tests, deploy) |
| Frontend | Next.js 16 (pages router), React 18, CSS Modules, tweetnacl for the encryption |
| Backend | Vercel Functions (Next.js `pages/api`), Sign-In with Ethereum (`siwe`), httpOnly cookie sessions (`iron-session`), Neon Postgres (`@neondatabase/serverless`), OpenAPI 3 with Swagger UI |
| Chain access | ethers 6: reads through the public RPC, transactions through MetaMask (`BrowserProvider`); the server reads friendships with a `JsonRpcProvider` |
| Network | Ethereum Hoodi testnet (chain 560048); a local Hardhat node (chain 1337) for development |
| Tests and checks | Hardhat tests (Mocha, Chai), API tests (`node:test`), ESLint (Next.js rules), an ABI freshness check, crypto round-trip tests |
| CI and hosting | GitHub Actions (CI on every push, daily uptime check), Vercel Hobby |
| Local setup | Node 22 pinned with mise |

### Design decisions

1. **Identity on chain, messages off chain.** Friendships and public keys need to be tamper-proof and
   readable by anyone, so they live in `Registry`; message text would be public and costs gas on
   chain, so it goes through the API as ciphertext. Trade-off: the server can drop or delay a message
   and sees who talks to whom and when; it cannot read one.
2. **Keys from a wallet signature, not stored.** Nothing secret is saved in a browser or on a server;
   the price is a signature prompt per page load before messages open. The app compares the derived
   public key with the one registered and refuses to continue if they differ (a wallet that signs the
   same text differently each time would otherwise lock you out silently).
3. **The server checks friendships on chain.** One `areFriends` read per send, a positive answer
   cached for 60 seconds. A failed read answers 503 and stores nothing; a stale yes lasts at most a
   minute after a friendship ends.
4. **Polling, not websockets.** Vercel Functions cannot hold a socket open on the free plan; a
   4 second poll while the tab is visible is enough for a chat of this size.
5. **Configuration is checked in one place at build time.** `Context/config.js` stops the build when
   a contract address, the start block or the network is missing or malformed.
6. **The contract ABIs are checked-in files, kept fresh by CI.** The frontend imports
   `Context/Registry.json` and `Context/NodeToken.json`; CI fails when they differ from the compiled
   contracts.

<details>
<summary><strong>Project structure</strong></summary>

```
contracts/                 Registry, NodeToken, ChatAnchor, Mining; ChatApp.sol is the legacy version
test/                      contract tests (Hardhat)
scripts/deploy.js          deploys the contracts; export-abi.js copies the ABIs to Context/
lib/client/crypto.js       key derivation, encrypt and decrypt (browser and Node)
lib/server/                the API: sign-in, messages, chain reader, Neon store, OpenAPI
api-tests/                 API and crypto tests (node:test)
Context/config.js          reads and checks every environment variable (the only place that does)
Context/networks.js        networks MetaMask can be switched to (hoodi, sepolia, localhost)
Context/ChatAppContext.js  app state: profiles and friendships from the Registry, keys, session, thread
Utils/apiFeature.js        MetaMask connection, contract instances, event reads
Utils/chatApi.js           calls to /api (sign-in, send, read)
Components/                NavBar, Avatar, AccountDialog, EmptyState, Notice, Spinner
pages/                     / (chat), /alluser (find people and requests), /leaderboard, /api
.github/workflows/         ci.yml (lint, tests, ABI check, build), uptime.yml (daily)
```

</details>

## Engineering quality

| Area | What is in place |
|---|---|
| Tests | 49 Hardhat tests, all passing on 2026-10-18: the 9 of `ChatApp`, plus the rework contracts (claim, replay, binding to the sender, cap, retarget, halving, every revert; registry and anchor rules; token cap and minter) |
| CI | GitHub Actions on every push: ESLint, the contract tests, Slither (0 findings, the timestamp detector excluded because epochs are time-based), a check that `Context/Registry.json` and `Context/NodeToken.json` match the compiled contracts, and the production build |
| Uptime | A daily workflow requests `/`, `/alluser` and `/leaderboard` on the live site and fails unless each answers 200 with the app |
| API | Sign-In with Ethereum (EIP-4361): single-use nonces that expire in 5 minutes, message domain and chain checked, session in an httpOnly SameSite=Lax cookie; the messages API accepts only base64 ciphertext, caps it at 4096 characters and rate limits 30 messages per minute per address; every response carries a request id and JSON logs hold no message content. every send is checked against the Registry (403 for a non-friend, 503 when the chain cannot be read); 17 API tests pass against Neon and 26 tests (API plus 6 crypto) against the in-memory store (2026-10-23) |
| Security | No secrets in the frontend (only public `NEXT_PUBLIC_` values); the deployer key lives only in a local `.env`; security headers from `vercel.json` (`nosniff`, `DENY` framing, referrer and permissions policies) |
| Measured | Lighthouse on the live site, 2026-10-12 (mobile / desktop): performance 89-90 / 99, accessibility 100 / 100, best practices 100 / 100, SEO 100 / 100 |
| Dependencies | `npm audit --omit=dev` (what ships to the browser) reports no vulnerabilities; the remaining findings are in Hardhat's development toolchain |

Run them:

```bash
npm run lint      # ESLint
npm test          # contract tests
npm run test:api  # API tests (add STORE=neon DATABASE_URL=... to run against Neon)
npm run slither   # static analysis (pip install slither-analyzer solc-select)
npm run build     # production build
```

## Run it locally

Works on Windows (Git Bash), macOS and Linux. You need **Git**, **Node 22** (pinned in `mise.toml`;
[mise](https://mise.jdx.dev) installs it) and the **MetaMask** browser extension.

```bash
git clone https://github.com/A-RYAN-1/node-connect.git
cd node-connect
mise install            # skip if you manage Node another way
npm ci
cp .env.example .env    # the defaults point at the public Hoodi contract
npm run dev
```

Open `http://localhost:3000`, connect MetaMask and approve the switch to Hoodi. Writes need a little
Hoodi ETH from a faucet (see [Try it live](#try-it-live)).

**On a local chain** (no testnet ETH, no MetaMask warning):

```bash
npm run node            # terminal 1: Hardhat node on http://127.0.0.1:8545 with funded test accounts
npm run deploy-local    # terminal 2: deploys the contract and prints its address
```

In `.env`, set `NEXT_PUBLIC_REGISTRY_ADDRESS` and `NEXT_PUBLIC_TOKEN_ADDRESS` to the printed addresses, `NEXT_PUBLIC_REGISTRY_START_BLOCK=0` and `NEXT_PUBLIC_NETWORK=localhost`,
run `npm run dev`, and import one of the test accounts `npm run node` prints into MetaMask. Those
accounts and keys are public and only for the local chain.

<details>
<summary><strong>Deploy your own contract to Hoodi</strong></summary>

1. Create a fresh MetaMask account that will only ever hold testnet ETH, and fund it from a Hoodi
   faucet.
2. Put its private key in `.env` as `DEPLOYER_PRIVATE_KEY` (optionally an Alchemy or Infura URL as
   `HOODI_RPC_URL`).
3. Run `npm run deploy` and set `NEXT_PUBLIC_REGISTRY_ADDRESS`, `NEXT_PUBLIC_TOKEN_ADDRESS` and `NEXT_PUBLIC_REGISTRY_START_BLOCK` to what it prints.
4. If you changed a contract, run `npm run abi` so the frontend uses the new ABI.

</details>

<details>
<summary><strong>Troubleshooting</strong></summary>

- **The build stops with a config error.** `Context/config.js` checks the variables; copy
  `.env.example` to `.env` (or set them on the host) and build again.
- **MetaMask shows the wrong network.** Click Connect Wallet again and approve the network switch.
- **A transaction fails with "insufficient funds".** The account needs a little Hoodi ETH.
- **Local chain: MetaMask reports a nonce error after restarting `npm run node`.** The chain was
  reset; in MetaMask, Settings, Advanced, clear the activity data for that account.
- **`npm ci` fails on Node 18 or 20.** The project needs Node 22 (`mise install`).

</details>

## Environment variables

All of them are listed with comments in [`.env.example`](.env.example).

| Variable | What it is | Needed |
|---|---|---|
| `NEXT_PUBLIC_REGISTRY_ADDRESS`, `NEXT_PUBLIC_TOKEN_ADDRESS` | Addresses of the deployed `Registry` and `NodeToken` contracts. Public. | app (build time) |
| `NEXT_PUBLIC_REGISTRY_START_BLOCK` | Block the Registry was deployed in; event reads start there. Public. | app (build time) |
| `NEXT_PUBLIC_NETWORK` | Network MetaMask is switched to: `hoodi`, `sepolia` or `localhost` (`Context/networks.js`). Public. | app (build time) |
| `HOODI_RPC_URL` | Hoodi RPC URL; defaults to the free public node | `npm run deploy`, optional |
| `DEPLOYER_PRIVATE_KEY` | Key of a testnet-only deployer wallet. Secret: only in your local `.env`, never on the host | `npm run deploy` |
| `DATABASE_URL` | Neon Postgres connection string. Secret. | API, `npm run db:migrate` |
| `SESSION_SECRET` | 32+ random characters encrypting the session cookie. Secret. | API |
| `SIWE_ALLOWED_DOMAINS` | Host(s) a sign-in message may name, for example `node-connect-sigma.vercel.app` | API (required in production) |
| `SIWE_CHAIN_ID`, `MESSAGES_PER_MINUTE`, `REGISTRY_ADDRESS`, `HOODI_RPC_URL` | Optional overrides (defaults: 560048, 30, the Registry in `deployments/hoodi.json`, the public node); the API uses the last two to check friendships | API, optional |

`NEXT_PUBLIC_` values are compiled into the public JavaScript, so they must never hold a secret.
Never commit a real `.env` file; only `.env.example` is tracked.

## Deployment

The site and its API run on Vercel's free Hobby plan (pages are prerendered, `pages/api` becomes Vercel Functions), with the messages in a free Neon Postgres database; the contracts live on the Hoodi testnet (addresses above).

| Part | Where it runs | How it deploys | Variables it needs |
|---|---|---|---|
| Website | Vercel Hobby (free), https://node-connect-sigma.vercel.app | automatically on every push to `main` (Vercel Git integration; checked 2026-10-16) | `NEXT_PUBLIC_REGISTRY_ADDRESS`, `NEXT_PUBLIC_TOKEN_ADDRESS`, `NEXT_PUBLIC_REGISTRY_START_BLOCK`, `NEXT_PUBLIC_NETWORK`, `DATABASE_URL`, `SESSION_SECRET`, `SIWE_ALLOWED_DOMAINS` (Production and Preview) |
| Contract | Hoodi testnet | by hand, `npm run deploy` from a local `.env`; never from CI | `DEPLOYER_PRIVATE_KEY`, optional `HOODI_RPC_URL` (local only) |

What a visitor notices (checked 2026-10-16): the site itself has no cold start; every write waits for
a Hoodi block and needs test ETH from a faucet; the public RPC node is shared and can be slow at
times.

<details>
<summary><strong>Host your own copy on Vercel</strong></summary>

1. Import the repository in Vercel (framework: Next.js, no root directory).
2. Create a free Neon database (Vercel Storage), run `npm run db:migrate` once with its `DATABASE_URL`,
   and set `NEXT_PUBLIC_REGISTRY_ADDRESS`, `NEXT_PUBLIC_TOKEN_ADDRESS`, `NEXT_PUBLIC_REGISTRY_START_BLOCK`, `NEXT_PUBLIC_NETWORK`, `DATABASE_URL`, `SESSION_SECRET` and
   `SIWE_ALLOWED_DOMAINS` in the project's Environment Variables for Production and Preview.
3. Deploy. `vercel.json` adds the security headers; `.vercelignore` keeps env files and build output
   out of CLI uploads.

</details>

## Status and roadmap

**Reached:** production baseline on 2026-10-12 (Next.js 16 and ethers 6, contract tests, lint and
build in CI, checked configuration, security headers, a daily uptime check, the Lighthouse scores
above), and auto-deploy on push since 2026-10-16. Checked by hand on the live site on 2026-10-13:
adding a friend and sending a message on Hoodi.

**Live check, 2026-10-23 (PR #4 on production):** two throwaway wallets registered with their chat keys on the Registry, sent a friend request and accepted it; sending was refused with 403 before the request and after it, stored (201) after the acceptance; the friend opened the message, replied, and both sides decrypted the full history after a reload; a third signed-in address read an empty thread and was refused (403) when sending. The Neon `messages` table held two rows, both base64 with no plaintext, and they were deleted afterwards. The profiles `nc-live-A` and `nc-live-B` remain on chain and show in Find people. The screenshots above show the earlier interface and are refreshed in a later pass.

**Known limitations**

- The server sees who messages whom and when, and can drop a message; it cannot read one. Losing
  the wallet means losing the key: old messages cannot be opened again.
- Opening messages needs a signature per page load (the key is not stored anywhere).
- Rewards: mining is not wired in yet, so every TOK balance is zero. The legacy in-contract balance
  is no longer shown.
- Creating an account and answering a friend request still cost a MetaMask confirmation and gas.
- Friend and user lists are rebuilt from contract events and one read per user on every load; fine
  for a demo-sized network, not for thousands of users.
- No frontend or browser tests yet. The encrypted flow was checked on the live site on 2026-10-23 through the real API with two throwaway wallets (see Status); the MetaMask screens themselves were not clicked through.

**Planned: the rework** (agreed 2026-10-13; each step merged and deployed before the next)

- [x] Contracts and tests (done 2026-10-18, deployed and verified from a fresh wallet; the site switches in a later step): an OpenZeppelin ERC-20 token (TOK) with a hard cap, a registry with
      friend requests (request, accept, decline, remove, block), deployed and verified from a fresh
      wallet, which should also end the MetaMask warning
- [x] Backend on Vercel Functions and Neon (built 2026-10-23): Sign-In with Ethereum, a messages API that
      stores only ciphertext, OpenAPI at `/api/openapi.json` and Swagger UI at `/api/docs`; the chat UI
      is used by the chat UI since the encrypted-chat release. Still to do: the scheduled job that anchors each day's message hashes on chain
- [x] End-to-end encrypted chats (keys derived from one wallet signature) and the chat UI wired to the API with
      sending, failed and retry states (merged and live 2026-10-23, PR #4)
- [ ] Real token mining: proof of activity plus proof of work, one claim per user per day, bound to
      the sender, with retargeting and halving; mined in a Web Worker
- [ ] Production checks again (Slither in CI, API tests, Lighthouse), then this README

## Credits

Built by **Aryan Deshmukh** ([A-RYAN-1](https://github.com/A-RYAN-1)): the contract, its tests, the
frontend, and the 2026 upgrade (Hoodi, Next.js 16, ethers 6, CI, deployment).
[RealFalseGod](https://github.com/RealFalseGod) contributed the leaderboard page and the token
balance in the header (October 2025).
