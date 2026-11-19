// Browser test of the chat UI on a local chain: two mock wallets create accounts,
// become friends and exchange an encrypted message through the real pages and API; then a
// third wallet joins a group, reads it, is removed and can read nothing sent after.
// Run with `npm run test:e2e` (needs Chrome or `npx playwright-core install chromium`).
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");
const { JsonRpcProvider, Wallet } = require("ethers");

const root = path.join(__dirname, "..");
const PORT = 3100;
const RPC = "http://127.0.0.1:8545";
const SHOTS = process.env.E2E_SHOTS || "";
// Hardhat's well-known development accounts #2, #3 and #4 (public test keys, no value).
const KEYS = {
  alice: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  bob: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  carol: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
};

const children = [];
const run = (cmd, args, env = {}) => {
  const child = spawn(cmd, args, {
    cwd: root,
    env: { ...process.env, ...env },
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.output = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (d) => (child.output += d));
  children.push(child);
  return child;
};
const stop = () => {
  for (const c of children) {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(c.pid), "/t", "/f"]);
    else c.kill();
  }
};

const until = async (what, check, ms = 90000) => {
  const end = Date.now() + ms;
  for (;;) {
    try {
      if (await check()) return;
    } catch {
      // not ready yet
    }
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 500));
  }
};

// window.ethereum in the page forwards to this Node side, which signs with a real key.
const installWallet = async (context, key) => {
  const provider = new JsonRpcProvider(RPC, undefined, { staticNetwork: true });
  const wallet = new Wallet(key, provider);
  await context.exposeBinding("__wallet", async (_src, method, params) => {
    switch (method) {
      case "eth_accounts":
      case "eth_requestAccounts":
        return [wallet.address];
      case "wallet_switchEthereumChain":
        return null;
      case "personal_sign":
        // MetaMask accepts hex or plain text; hex is decoded, anything else signed as text.
        return wallet.signMessage(/^0x([0-9a-f]{2})+$/i.test(params[0]) ? Buffer.from(params[0].slice(2), "hex") : params[0]);
      case "eth_sendTransaction": {
        const { from, ...tx } = params[0];
        const sent = await wallet.sendTransaction(tx);
        return sent.hash;
      }
      default:
        return provider.send(method, params);
    }
  });
  await context.addInitScript(() => {
    window.ethereum = {
      isMetaMask: true,
      request: ({ method, params }) => window.__wallet(method, params || []),
      on() {},
      removeListener() {},
    };
  });
  return wallet.address;
};

const shot = (page, name) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, `${name}.png`) }) : null);

async function main() {
  const base = `http://localhost:${PORT}`;
  run("npx", ["hardhat", "node"]);
  await until("the local chain", async () => {
    const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' });
    return res.ok;
  });
  const deploy = run("npx", ["hardhat", "run", "scripts/deploy.js", "--network", "localhost"]);
  await new Promise((resolve, reject) =>
    deploy.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(deploy.output))))
  );
  const d = JSON.parse(fs.readFileSync(path.join(root, "deployments", "localhost.json"), "utf8"));

  const siteEnv = {
    NEXT_PUBLIC_NETWORK: "localhost",
    NEXT_PUBLIC_REGISTRY_ADDRESS: d.registry,
    NEXT_PUBLIC_TOKEN_ADDRESS: d.token,
    NEXT_PUBLIC_MINING_ADDRESS: d.mining,
    NEXT_PUBLIC_REGISTRY_START_BLOCK: "0",
    DATABASE_URL: "memory",
    SESSION_SECRET: "e2e-session-secret-e2e-session-secret",
    SIWE_CHAIN_ID: String(d.chainId),
    SIWE_ALLOWED_DOMAINS: `localhost:${PORT}`,
    HOODI_RPC_URL: RPC,
    REGISTRY_ADDRESS: d.registry,
    ANCHOR_ADDRESS: d.chatAnchor,
    ANCHOR_GENESIS: String(d.anchorGenesis),
  };
  // A production build and server: same pages, no on-demand compiling during the test.
  const build = run("npx", ["next", "build"], siteEnv);
  await new Promise((resolve, reject) =>
    build.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(build.output))))
  );
  run("npx", ["next", "start", "-p", String(PORT)], siteEnv);
  await until("the site", async () => (await fetch(`${base}/api/health`)).ok);

  const browser = await chromium.launch({ channel: process.env.E2E_CHANNEL || "chrome" });
  try {
    const open = async (key) => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const address = await installWallet(context, key);
      const page = await context.newPage();
      page.setDefaultTimeout(60000);
      await page.goto(base, { waitUntil: "domcontentloaded" });
      return { page, address };
    };
    const alice = await open(KEYS.alice);
    const bob = await open(KEYS.bob);

    // Each wallet connects and creates its account (chat key signature plus one transaction).
    for (const [who, name] of [[alice, "Alice"], [bob, "Bob"]]) {
      const { page } = who;
      await page.getByRole("button", { name: "Create account" }).first().click();
      await page.getByLabel("Name").fill(name);
      await page.getByRole("dialog").getByRole("button", { name: "Create account" }).click();
      await page.getByRole("heading", { name: "Friends" }).waitFor();
    }
    await shot(alice.page, "01-friends-empty");

    // Alice asks Bob; Bob accepts.
    await alice.page.goto(`${base}/alluser`, { waitUntil: "domcontentloaded" });
    await alice.page.getByRole("button", { name: "Send request" }).click();
    await alice.page.getByText("Request sent").waitFor();
    await shot(alice.page, "02-request-sent");

    await bob.page.goto(`${base}/alluser`, { waitUntil: "domcontentloaded" });
    await bob.page.getByRole("button", { name: "Accept" }).click();
    await bob.page.getByRole("link", { name: "Chat" }).first().click();
    await bob.page.getByRole("link", { name: /Alice/ }).click();

    // Bob unlocks and sends; Alice unlocks and reads the decrypted text.
    await bob.page.getByRole("button", { name: "Unlock messages" }).click();
    await bob.page.getByLabel("Message").fill("hello from Bob");
    await bob.page.getByRole("button", { name: "Send" }).click();
    await bob.page.locator(".bubble.mine", { hasText: "hello from Bob" }).waitFor();
    await bob.page.locator(".bubble.pending").waitFor({ state: "detached" });
    await shot(bob.page, "03-bob-sent");

    await alice.page.goto(base, { waitUntil: "domcontentloaded" });
    await alice.page.getByRole("link", { name: /Bob/ }).click();
    await alice.page.getByRole("button", { name: "Unlock messages" }).click();
    await alice.page.locator(".bubble", { hasText: "hello from Bob" }).waitFor();
    assert.equal(await alice.page.locator(".bubble.unreadable").count(), 0);
    await shot(alice.page, "04-alice-reads");

    // Group chat: Carol joins the network, becomes Alice's friend, and Alice starts a room.
    const carol = await open(KEYS.carol);
    await carol.page.getByRole("button", { name: "Create account" }).first().click();
    await carol.page.getByLabel("Name").fill("Carol");
    await carol.page.getByRole("dialog").getByRole("button", { name: "Create account" }).click();
    await carol.page.getByRole("heading", { name: "Friends" }).waitFor();

    await alice.page.goto(`${base}/alluser`, { waitUntil: "domcontentloaded" });
    await alice.page.getByRole("button", { name: "Send request" }).click();
    await alice.page.getByText("Request sent").waitFor();
    await carol.page.goto(`${base}/alluser`, { waitUntil: "domcontentloaded" });
    await carol.page.getByRole("button", { name: "Accept" }).click();
    await carol.page.getByRole("link", { name: "Chat" }).first().click();

    const unlockGroups = async (who) => {
      await who.page.goto(base, { waitUntil: "domcontentloaded" });
      await who.page.getByRole("region", { name: "Groups" }).getByRole("button", { name: "Unlock" }).click();
      await who.page.getByRole("region", { name: "Groups" }).getByRole("button", { name: "Unlock" }).waitFor({ state: "detached" });
    };
    await unlockGroups(alice);
    await alice.page.getByRole("button", { name: "New group" }).click();
    await alice.page.getByLabel("Group name").fill("Weekend trip");
    await alice.page.getByRole("checkbox", { name: "Bob" }).check();
    await alice.page.getByRole("checkbox", { name: "Carol" }).check();
    await shot(alice.page, "05-new-group");
    await alice.page.getByRole("button", { name: "Create group" }).click();
    await alice.page.getByRole("region", { name: "Group Weekend trip" }).waitFor();
    await alice.page.getByLabel("Message").fill("plan: saturday 9am");
    await alice.page.getByRole("button", { name: "Send" }).click();
    await alice.page.locator(".bubble.mine", { hasText: "plan: saturday 9am" }).waitFor();
    await alice.page.locator(".bubble.pending").waitFor({ state: "detached" });

    // Bob and Carol find the room by name, unlock it and read the same text, with the author shown.
    for (const who of [bob, carol]) {
      await unlockGroups(who);
      await who.page.getByRole("link", { name: /Weekend trip/ }).click();
      const bubble = who.page.locator(".bubble", { hasText: "plan: saturday 9am" });
      await bubble.waitFor();
      assert.equal(await bubble.locator(".bubble-author").innerText(), "Alice");
      assert.equal(await who.page.locator(".bubble.unreadable").count(), 0);
    }
    await bob.page.getByLabel("Message").fill("count me in");
    await bob.page.getByRole("button", { name: "Send" }).click();
    await alice.page.locator(".bubble", { hasText: "count me in" }).waitFor();
    await carol.page.locator(".bubble", { hasText: "count me in" }).waitFor();
    await shot(alice.page, "06-group-chat");

    // Alice removes Carol and sends again: Bob reads it, Carol loses the room and never sees it.
    await alice.page.getByRole("button", { name: "Members" }).click();
    await shot(alice.page, "07-group-members");
    await alice.page.getByRole("button", { name: "Remove Carol" }).click();
    await alice.page.getByRole("button", { name: "Remove Carol" }).waitFor({ state: "detached" });
    await alice.page.getByLabel("Message").fill("carol is out");
    await alice.page.getByRole("button", { name: "Send" }).click();
    await bob.page.locator(".bubble", { hasText: "carol is out" }).waitFor();
    await carol.page.getByText("Group not available").waitFor();
    assert.equal(await carol.page.getByText("carol is out").count(), 0);
    assert.equal(await carol.page.getByRole("link", { name: /Weekend trip/ }).count(), 0);

    // The messages API refuses a caller with no session.
    const anon = await fetch(`${base}/api/messages?with=${bob.address}`);
    assert.equal(anon.status, 401);
    assert.equal((await fetch(`${base}/api/groups`)).status, 401);
    console.log("e2e passed: account, friendship, encrypted message, group chat with a removed member");
  } finally {
    await browser.close();
  }
}

main()
  .then(() => {
    stop();
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    for (const c of children) console.error(c.output.split("\n").slice(-15).join("\n"));
    stop();
    process.exit(1);
  });
