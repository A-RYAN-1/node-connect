import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/router";

import {
  checkIfWalletConnected,
  connectWallet as requestWallet,
  connectingWithContract,
  hasWallet,
  queryAllLogs,
  readRegistry,
  readToken,
  signWithWallet,
  errorMessage,
} from "../Utils/apiFeature";
import { getSession, signIn, sendCiphertext, listThread } from "../Utils/chatApi";
import {
  KEY_MESSAGE,
  keyPairFromSignature,
  encrypt,
  decrypt,
  toHex,
} from "../lib/client/crypto";

export const ChatAppContext = React.createContext();

const sameAddress = (a, b) => a.toLowerCase() === b.toLowerCase();
const UNREADABLE = "This message could not be decrypted.";

export const ChatAppProvider = ({ children }) => {
  const [account, setAccount] = useState("");
  const [userName, setUserName] = useState("");
  const [ready, setReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState("");
  const [people, setPeople] = useState([]);
  const [friendMsg, setFriendMsg] = useState([]);
  const [pendingMsg, setPendingMsg] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [tokenBalance, setTokenBalance] = useState(0);
  const [error, setError] = useState("");
  const connectingRef = useRef(false);
  const keysRef = useRef(null);
  const peopleRef = useRef([]);
  const sessionRef = useRef(false);

  const router = useRouter();

  const loadAccount = useCallback(async (address) => {
    const registry = readRegistry();
    const [registered, updated] = await Promise.all([
      queryAllLogs(registry, registry.filters.Registered()),
      queryAllLogs(registry, registry.filters.ProfileUpdated()),
    ]);
    // The newest event of a user holds the current name and key.
    const events = [...registered, ...updated].sort(
      (a, b) => a.blockNumber - b.blockNumber || a.index - b.index
    );
    const profiles = new Map();
    for (const e of events) {
      profiles.set(e.args.user.toLowerCase(), {
        address: e.args.user,
        name: e.args.name,
        key: e.args.encryptionKey,
      });
    }

    const me = profiles.get(address.toLowerCase());
    setUserName(me ? me.name : "");

    const others = [...profiles.values()].filter((p) => !sameAddress(p.address, address));
    const withRelation = await Promise.all(
      others.map(async (p) => {
        if (!me) return { ...p, relation: "none" };
        const [friends, outgoing, incoming] = await Promise.all([
          registry.areFriends(address, p.address),
          registry.hasRequested(address, p.address),
          registry.hasRequested(p.address, address),
        ]);
        let relation = "none";
        if (friends) relation = "friend";
        else if (incoming) relation = "incoming";
        else if (outgoing) relation = "outgoing";
        return { ...p, relation };
      })
    );
    peopleRef.current = withRelation;
    setPeople(withRelation);

    const token = readToken();
    const everyone = [...profiles.values()];
    const balances = await Promise.all(everyone.map((p) => token.balanceOf(p.address)));
    const ranked = everyone
      .map((p, i) => ({ ...p, tokens: Number(balances[i] / 10n ** 18n) }))
      .sort((a, b) => b.tokens - a.tokens);
    setLeaderboard(ranked);
    const mine = ranked.find((p) => sameAddress(p.address, address));
    setTokenBalance(mine ? mine.tokens : 0);
  }, []);

  // Load the already-connected account (no MetaMask prompt) on page load
  useEffect(() => {
    checkIfWalletConnected()
      .then(async (address) => {
        if (!address) return;
        setAccount(address);
        sessionRef.current = sameAddress((await getSession()) || "0x0", address);
        await loadAccount(address);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setReady(true));

    if (!hasWallet()) return undefined;
    // Reload the data when the user switches account in MetaMask
    const onAccountsChanged = () => window.location.reload();
    window.ethereum.on?.("accountsChanged", onAccountsChanged);
    return () =>
      window.ethereum.removeListener?.("accountsChanged", onAccountsChanged);
  }, [loadAccount]);

  // One MetaMask prompt at a time: a second request while the first is
  // open is rejected by MetaMask (error -32002).
  const connectWallet = async () => {
    if (connectingRef.current) return;
    connectingRef.current = true;
    setConnecting(true);
    try {
      const address = await requestWallet();
      if (!address) return;
      setAccount(address);
      sessionRef.current = sameAddress((await getSession()) || "0x0", address);
      await loadAccount(address);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      connectingRef.current = false;
      setConnecting(false);
    }
  };

  // The chat key comes from one signature of a fixed text, so the same wallet
  // always rebuilds the same keys and nothing is stored.
  const ensureKeys = async () => {
    if (keysRef.current) return keysRef.current;
    const signature = await signWithWallet(KEY_MESSAGE, account);
    keysRef.current = keyPairFromSignature(signature);
    return keysRef.current;
  };

  const ensureSession = async () => {
    if (sessionRef.current) return;
    await signIn(account, (message) => signWithWallet(message, account));
    sessionRef.current = true;
  };

  // Signs in to the API and builds the chat key: two signatures at most, no
  // gas. Returns true when messages can be sent and read.
  const unlock = async () => {
    if (unlocked) return true;
    setUnlocking(true);
    try {
      const keys = await ensureKeys();
      const registered = await readRegistry().profileOf(account);
      if (registered.registeredAt !== 0n && registered.encryptionKey !== toHex(keys.publicKey)) {
        keysRef.current = null;
        setError(
          "This wallet produced a different chat key than the one registered for this account, so its messages cannot be opened."
        );
        return false;
      }
      await ensureSession();
      setUnlocked(true);
      return true;
    } catch (err) {
      keysRef.current = null;
      setError(errorMessage(err));
      return false;
    } finally {
      setUnlocking(false);
    }
  };

  // Sends a transaction and waits for it to be mined. Returns true when it
  // went through, so the caller can keep its input when it did not.
  const runTransaction = async (label, send, after) => {
    setBusy(label);
    try {
      const contract = await connectingWithContract();
      const tx = await send(contract);
      await tx.wait();
      await after();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy("");
    }
  };

  const lostSession = () => {
    sessionRef.current = false;
    setUnlocked(false);
  };

  const toBubble = (row) => {
    const other = sameAddress(row.sender, account) ? row.recipient : row.sender;
    const key = peopleRef.current.find((p) => sameAddress(p.address, other))?.key;
    const text = key ? decrypt(row.ciphertext, keysRef.current.secretKey, key) : null;
    return {
      id: row.id,
      sender: row.sender,
      text: text ?? UNREADABLE,
      readable: text !== null,
      timestamp: Math.floor(new Date(row.createdAt).getTime() / 1000),
    };
  };

  // Newest-first rows from the API become an oldest-first, decrypted thread.
  const readMessage = useCallback(
    async (address) => {
      if (!keysRef.current || !sessionRef.current) return;
      try {
        const rows = await listThread(address);
        setFriendMsg(rows.map(toBubble).reverse());
      } catch (err) {
        if (err.status === 401) lostSession();
        setError(errorMessage(err));
      }
    },
    // toBubble reads refs and the account only
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [account]
  );

  const clearThread = useCallback(() => setFriendMsg([]), []);

  const createAccount = async ({ name }) => {
    if (!name?.trim() || !account) {
      setError("Choose a name first.");
      return false;
    }
    setBusy("account");
    let keys;
    try {
      keys = await ensureKeys();
    } catch (err) {
      setError(errorMessage(err));
      setBusy("");
      return false;
    }
    return runTransaction(
      "account",
      (contract) => contract.register(name.trim(), toHex(keys.publicKey)),
      () => loadAccount(account)
    );
  };

  const requestFriend = (address) =>
    runTransaction(
      `friend:${address}`,
      (contract) => contract.request(address),
      () => loadAccount(account)
    );

  const acceptFriend = (address, name) =>
    runTransaction(
      `friend:${address}`,
      (contract) => contract.accept(address),
      async () => {
        await loadAccount(account);
        router.push({ pathname: "/", query: { name, address } });
      }
    );

  const declineFriend = (address) =>
    runTransaction(
      `friend:${address}`,
      (contract) => contract.decline(address),
      () => loadAccount(account)
    );

  // The message shows at once as sending. If the API refuses it, it stays in
  // the thread as failed with a retry; nothing is lost.
  const deliver = async (pending) => {
    setPendingMsg((list) =>
      list.map((m) => (m.id === pending.id ? { ...m, state: "sending" } : m))
    );
    try {
      const recipient = peopleRef.current.find((p) => sameAddress(p.address, pending.to));
      const ciphertext = encrypt(pending.text, keysRef.current.secretKey, recipient.key);
      await sendCiphertext(pending.to, ciphertext);
      setPendingMsg((list) => list.filter((m) => m.id !== pending.id));
      await readMessage(pending.to);
      return true;
    } catch (err) {
      if (err.status === 401) lostSession();
      setPendingMsg((list) =>
        list.map((m) =>
          m.id === pending.id ? { ...m, state: "failed", reason: errorMessage(err) } : m
        )
      );
      return false;
    }
  };

  const sendMessage = async ({ msg, address }) => {
    const text = msg?.trim();
    if (!text || !address) return false;
    const pending = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      to: address,
      sender: account,
      text,
      state: "sending",
    };
    setPendingMsg((list) => [...list, pending]);
    return deliver(pending);
  };

  const retryMessage = (id) => {
    const pending = pendingMsg.find((m) => m.id === id);
    if (pending) deliver(pending);
  };

  const dismissMessage = (id) =>
    setPendingMsg((list) => list.filter((m) => m.id !== id));

  const friendLists = people.filter((p) => p.relation === "friend");

  return (
    <ChatAppContext.Provider
      value={{
        readMessage,
        clearThread,
        createAccount,
        requestFriend,
        acceptFriend,
        declineFriend,
        sendMessage,
        retryMessage,
        dismissMessage,
        unlock,
        connectWallet,
        account,
        userName,
        ready,
        connecting,
        unlocking,
        unlocked,
        busy,
        friendLists,
        friendMsg,
        pendingMsg,
        people,
        error,
        clearError: () => setError(""),
        leaderboard,
        tokenBalance,
      }}
    >
      {children}
    </ChatAppContext.Provider>
  );
};
