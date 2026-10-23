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

const POLL_MS = 4000;
const MAX_CHARS = 1000;

const Conversation = ({ name, address }) => {
  const [text, setText] = useState("");
  const end = useRef(null);
  const {
    account,
    friendMsg,
    pendingMsg,
    readMessage,
    clearThread,
    sendMessage,
    retryMessage,
    dismissMessage,
    unlock,
    unlocked,
    unlocking,
  } = useContext(ChatAppContext);

  useEffect(() => {
    clearThread();
    if (!unlocked) return undefined;
    readMessage(address);
    // New messages arrive by polling while the conversation is on screen.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") readMessage(address);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [address, unlocked, readMessage, clearThread]);

  const mine = pendingMsg.filter((m) => m.to === address);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [friendMsg.length, mine.length]);

  const submit = async (e) => {
    e.preventDefault();
    const draft = text;
    if (!draft.trim()) return;
    setText("");
    sendMessage({ msg: draft, address });
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

      {!unlocked ? (
        <div className="messages">
          <div className="empty">
            <h2>Unlock your messages</h2>
            <p>
              Messages are encrypted in your browser, so only you and {name} can
              read them. Sign two short texts in MetaMask to unlock them. It
              costs no gas.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={unlock}
              disabled={unlocking}
            >
              {unlocking && <Spinner />}
              {unlocking ? "Check MetaMask" : "Unlock messages"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="messages">
            {friendMsg.length === 0 && mine.length === 0 && (
              <p className="side-empty">
                No messages yet. Say hello; only you and {name} can read what
                you write.
              </p>
            )}
            {friendMsg.map((m) => (
              <div
                key={m.id}
                className={`bubble ${
                  m.sender.toLowerCase() === account.toLowerCase() ? "mine" : ""
                } ${m.readable ? "" : "unreadable"}`}
              >
                {m.text}
                <div className="bubble-meta">{formatTime(m.timestamp)}</div>
              </div>
            ))}
            {mine.map((m) => (
              <div key={m.id} className={`bubble mine pending ${m.state}`}>
                {m.text}
                {m.state === "sending" ? (
                  <div className="bubble-meta">Sending</div>
                ) : (
                  <div className="bubble-meta">
                    Not sent: {m.reason}{" "}
                    <button type="button" className="link" onClick={() => retryMessage(m.id)}>
                      Retry
                    </button>{" "}
                    <button type="button" className="link" onClick={() => dismissMessage(m.id)}>
                      Discard
                    </button>
                  </div>
                )}
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
              maxLength={MAX_CHARS}
              placeholder={`Message ${name}`}
              autoComplete="off"
              onChange={(e) => setText(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={!text.trim()}>
              Send
            </button>
          </form>
        </>
      )}
    </section>
  );
};

const Chat = () => {
  const { account, userName, ready, friendLists, people, connectWallet, connecting } =
    useContext(ChatAppContext);
  const incoming = people.filter((p) => p.relation === "incoming").length;
  const { query } = useRouter();
  const address = query.address || "";
  const name = query.name || "";

  if (!ready) return <div className="page" />;

  if (!account) {
    return (
      <div className="page">
        <EmptyState
          title="Chat that pays you back"
          text={`Connect your wallet to message friends on the ${NETWORK.chainName} network. Messages are end-to-end encrypted.`}
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
              <p>You have no friends yet. A friendship starts with a request and needs the other person to accept.</p>
              <p>
                <Link href="/alluser" className="btn btn-small" style={{ marginTop: 12 }}>
                  Find people
                </Link>
              </p>
            </div>
          ) : (
            <ul className="friend-list">
              {friendLists.map((f) => (
                <li key={f.address}>
                  <Link
                    className="friend"
                    aria-current={
                      address.toLowerCase() === f.address.toLowerCase()
                    }
                    href={{ pathname: "/", query: { name: f.name, address: f.address } }}
                  >
                    <Avatar name={f.name} address={f.address} />
                    <span className="friend-text">
                      <span className="friend-name">{f.name}</span>
                      <span className="friend-address">{shortAddress(f.address)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {incoming > 0 && (
            <p className="side-empty">
              <Link href="/alluser">
                {incoming} friend {incoming === 1 ? "request is" : "requests are"} waiting
              </Link>
            </p>
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
