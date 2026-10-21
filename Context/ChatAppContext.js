import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/router";

import {
  checkIfWalletConnected,
  connectWallet as requestWallet,
  connectingWithContract,
  hasWallet,
  toUser,
  toFriend,
  toMessage,
  errorMessage,
} from "../Utils/apiFeature";

export const ChatAppContext = React.createContext();

const sameAddress = (a, b) => a.toLowerCase() === b.toLowerCase();

export const ChatAppProvider = ({ children }) => {
  const [account, setAccount] = useState("");
  const [userName, setUserName] = useState("");
  const [ready, setReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState("");
  const [friendLists, setFriendLists] = useState([]);
  const [friendMsg, setFriendMsg] = useState([]);
  const [pendingMsg, setPendingMsg] = useState([]);
  const [userLists, setUserLists] = useState([]);
  const [userListsforleaderboard, setUserListsforleaderboard] = useState([]);
  const [tokenBalance, setTokenBalance] = useState(0);
  const [error, setError] = useState("");
  const connectingRef = useRef(false);

  const router = useRouter();

  const loadAccount = useCallback(async (address) => {
    const contract = await connectingWithContract();

    const registered = await contract.checkUserExists(address);
    const [allUsers, friends] = await Promise.all([
      contract.getAllAppUser().then((list) => list.map(toUser)),
      registered
        ? contract.getMyFriendList().then((list) => list.map(toFriend))
        : [],
    ]);

    setUserName(registered ? await contract.getUsername(address) : "");
    setFriendLists(friends);

    // Users you can add: everyone except you and your friends
    const friendAddresses = new Set(friends.map((f) => f.pubkey.toLowerCase()));
    setUserLists(
      allUsers.filter(
        (u) =>
          !sameAddress(u.accountAddress, address) &&
          !friendAddresses.has(u.accountAddress.toLowerCase())
      )
    );

    const rewards = await Promise.all(
      allUsers.map((u) => contract.minerReward(u.accountAddress))
    );
    const leaderboard = allUsers
      .map((u, i) => ({ ...u, tokens: Number(rewards[i]) }))
      .sort((a, b) => b.tokens - a.tokens);
    setUserListsforleaderboard(leaderboard);

    const mine = leaderboard.find((u) => sameAddress(u.accountAddress, address));
    setTokenBalance(mine ? mine.tokens : 0);
  }, []);

  // Load the already-connected account (no MetaMask prompt) on page load
  useEffect(() => {
    checkIfWalletConnected()
      .then(async (address) => {
        if (!address) return;
        setAccount(address);
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
      await loadAccount(address);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      connectingRef.current = false;
      setConnecting(false);
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

  const readMessage = useCallback(async (friendAddress) => {
    try {
      const contract = await connectingWithContract();
      const messages = await contract.readMessage(friendAddress);
      setFriendMsg(messages.map(toMessage));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  const createAccount = async ({ name }) => {
    if (!name?.trim() || !account) {
      setError("Choose a name first.");
      return false;
    }
    return runTransaction(
      "account",
      (contract) => contract.createAccount(name.trim()),
      () => loadAccount(account)
    );
  };

  const addFriends = async ({ name, userAddress }) => {
    if (!name || !userAddress) {
      setError("A name and an address are needed to add a friend.");
      return false;
    }
    return runTransaction(
      `friend:${userAddress}`,
      (contract) => contract.addFriend(userAddress, name),
      async () => {
        await loadAccount(account);
        router.push({ pathname: "/", query: { name, address: userAddress } });
      }
    );
  };

  // The message shows at once as pending and is replaced by the stored one
  // after the chain confirms it.
  const sendMessage = async ({ msg, address }) => {
    const text = msg?.trim();
    if (!text || !address) return false;
    const pending = { id: Date.now(), to: address, sender: account, msg: text };
    setPendingMsg((list) => [...list, pending]);
    const sent = await runTransaction(
      "message",
      (contract) => contract.sendMessage(address, text),
      async () => {
        await readMessage(address);
        await loadAccount(account);
      }
    );
    setPendingMsg((list) => list.filter((m) => m.id !== pending.id));
    return sent;
  };

  return (
    <ChatAppContext.Provider
      value={{
        readMessage,
        createAccount,
        addFriends,
        sendMessage,
        connectWallet,
        account,
        userName,
        ready,
        connecting,
        busy,
        friendLists,
        friendMsg,
        pendingMsg,
        userLists,
        error,
        clearError: () => setError(""),
        userListsforleaderboard,
        tokenBalance,
      }}
    >
      {children}
    </ChatAppContext.Provider>
  );
};
