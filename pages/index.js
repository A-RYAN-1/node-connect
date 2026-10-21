import React, { useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";

import { ChatAppContext } from "../Context/ChatAppContext";
import { NETWORK } from "../Context/config";
import { formatTime, shortAddress } from "../Utils/apiFeature";
import { Avatar, EmptyState, Spinner } from "../Components/index";

const BackIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M12 4 6 10l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Conversation = ({ name, address }) => {
  const [text, setText] = useState("");
  const end = useRef(null);
  const { account, friendMsg, pendingMsg, readMessage, sendMessage, busy } =
    useContext(ChatAppContext);

  useEffect(() => {
    readMessage(address);
  }, [address, readMessage]);

  const mine = pendingMsg.filter((m) => m.to === address);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [friendMsg.length, mine.length]);

  const submit = async (e) => {
    e.preventDefault();
    const draft = text;
    if (!draft.trim()) return;
    setText("");
    if (!(await sendMessage({ msg: draft, address }))) setText(draft);
  };

  return (
    <section className="chat-main" aria-label={`Chat with ${name}`}>
      <div className="chat-head">
        <Link href="/" className="back" aria-label="Back to friends">
          <BackIcon />
        </Link>
        <Avatar name={name} address={address} size={36} />
        <div className="friend-text">
          <div className="friend-name">{name}</div>
          <div className="friend-address" title={address}>
            {shortAddress(address)}
          </div>
        </div>
      </div>

      <div className="messages">
        {friendMsg.length === 0 && mine.length === 0 && (
          <p className="side-empty">
            No messages yet. Say hello; each message you send earns reward
            tokens.
          </p>
        )}
        {friendMsg.map((m, i) => (
          <div
            key={`${m.timestamp}-${i}`}
            className={`bubble ${
              m.sender.toLowerCase() === account.toLowerCase() ? "mine" : ""
            }`}
          >
            {m.msg}
            <div className="bubble-meta">{formatTime(m.timestamp)}</div>
          </div>
        ))}
        {mine.map((m) => (
          <div key={m.id} className="bubble mine pending">
            {m.msg}
            <div className="bubble-meta">Waiting for the network</div>
          </div>
        ))}
        <div ref={end} />
      </div>

      <form className="composer" onSubmit={submit}>
        <label className="visually-hidden" htmlFor="message">
          Message
        </label>
        <input
          id="message"
          className="input"
          value={text}
          placeholder={`Message ${name}`}
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!text.trim() || busy === "message"}
        >
          {busy === "message" && <Spinner />}
          Send
        </button>
      </form>
    </section>
  );
};

const Chat = () => {
  const { account, userName, ready, friendLists, connectWallet, connecting } =
    useContext(ChatAppContext);
  const { query } = useRouter();
  const address = query.address || "";
  const name = query.name || "";

  if (!ready) return <div className="page" />;

  if (!account) {
    return (
      <div className="page">
        <EmptyState
          title="Chat that pays you back"
          text={`Connect your wallet to message friends on the ${NETWORK.chainName} network. Every message earns reward tokens.`}
        >
          <button
            type="button"
            className="btn btn-primary"
            onClick={connectWallet}
            disabled={connecting}
          >
            {connecting && <Spinner />}
            {connecting ? "Check MetaMask" : "Connect wallet"}
          </button>
        </EmptyState>
      </div>
    );
  }

  if (!userName) {
    return (
      <div className="page">
        <EmptyState
          title="One step left"
          text="Create an account to pick the name your friends will see. Use the Create account button at the top right."
        />
      </div>
    );
  }

  return (
    <div className="page">
      <div className={`panel chat ${address ? "has-chat" : ""}`}>
        <aside className="chat-side" aria-label="Friends">
          <h1 className="side-title">Friends</h1>
          {friendLists.length === 0 ? (
            <div className="side-empty">
              <p>You have no friends yet.</p>
              <p>
                <Link href="/alluser" className="btn btn-small" style={{ marginTop: 12 }}>
                  Find people
                </Link>
              </p>
            </div>
          ) : (
            <ul className="friend-list">
              {friendLists.map((f) => (
                <li key={f.pubkey}>
                  <Link
                    className="friend"
                    aria-current={
                      address.toLowerCase() === f.pubkey.toLowerCase()
                    }
                    href={{ pathname: "/", query: { name: f.name, address: f.pubkey } }}
                  >
                    <Avatar name={f.name} address={f.pubkey} />
                    <span className="friend-text">
                      <span className="friend-name">{f.name}</span>
                      <span className="friend-address">{shortAddress(f.pubkey)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {address ? (
          <Conversation key={address} name={name} address={address} />
        ) : (
          <div className="chat-main">
            <div className="empty">
              <h2>Pick a friend</h2>
              <p>Choose someone on the left to open the conversation.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Chat;
