import React, { useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";

import { ChatAppContext } from "../Context/ChatAppContext";
import { NETWORK } from "../Context/config";
import { formatTime, shortAddress } from "../Utils/apiFeature";
import { Avatar, EmptyState, GroupDialog, Spinner } from "../Components/index";

const BackIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M12 4 6 10l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const POLL_MS = 4000;
const MAX_CHARS = 1000;

const same = (a, b) => a.toLowerCase() === b.toLowerCase();

// Decrypted messages followed by the ones still sending or failed. In a group
// each message from someone else shows who wrote it.
const Bubbles = ({ messages, pending, account, labelFor, retryMessage, dismissMessage, seenUpTo = 0 }) => {
  // "Seen" goes under the newest of my messages the other person has read.
  const seenId = Math.max(0, ...messages.filter((m) => same(m.sender, account) && m.id <= seenUpTo).map((m) => m.id));
  return (
    <>
      {messages.map((m) => (
        <div
          key={m.id}
          className={`bubble ${same(m.sender, account) ? "mine" : ""} ${m.readable ? "" : "unreadable"}`}
        >
          {labelFor && !same(m.sender, account) && <div className="bubble-author">{labelFor(m.sender)}</div>}
          {m.text}
          <div className="bubble-meta">
            {formatTime(m.timestamp)}
            {m.id === seenId && " \u00b7 Seen"}
          </div>
        </div>
      ))}
      {pending.map((m) => (
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
    </>
  );
};

const Unread = ({ count }) =>
  count ? (
    <span className="unread" aria-label={`${count} unread`}>
      {count > 99 ? "99+" : count}
    </span>
  ) : null;

const Composer = ({ placeholder, onSend }) => {
  const [text, setText] = useState("");
  const submit = (e) => {
    e.preventDefault();
    const draft = text;
    if (!draft.trim()) return;
    setText("");
    onSend(draft);
  };
  return (
    <form className="composer" onSubmit={submit}>
      <label className="visually-hidden" htmlFor="message">
        Message
      </label>
      <input
        id="message"
        className="input"
        value={text}
        maxLength={MAX_CHARS}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" className="btn btn-primary" disabled={!text.trim()}>
        Send
      </button>
    </form>
  );
};

const Unlock = ({ what }) => {
  const { unlock, unlocking } = useContext(ChatAppContext);
  return (
    <div className="messages">
      <div className="empty">
        <h2>Unlock your messages</h2>
        <p>
          Messages are encrypted in your browser, so only {what} can read them. Sign two short texts in
          MetaMask to unlock them. It costs no gas.
        </p>
        <button type="button" className="btn btn-primary" onClick={unlock} disabled={unlocking}>
          {unlocking && <Spinner />}
          {unlocking ? "Check MetaMask" : "Unlock messages"}
        </button>
      </div>
    </div>
  );
};

const Conversation = ({ name, address }) => {
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
    unlocked,
    theirRead,
    refreshReads,
    markRead,
  } = useContext(ChatAppContext);
  const marked = useRef(0);

  useEffect(() => {
    clearThread();
    marked.current = 0;
    if (!unlocked) return undefined;
    const refresh = () => {
      readMessage(address);
      refreshReads(address);
    };
    refresh();
    // New messages and read receipts arrive by polling while the conversation is on screen.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [address, unlocked, readMessage, refreshReads, clearThread]);

  // Seeing the newest message tells the server its id, nothing else.
  const newestId = friendMsg.length ? friendMsg[friendMsg.length - 1].id : 0;
  useEffect(() => {
    if (!unlocked || newestId <= marked.current) return;
    marked.current = newestId;
    markRead({ with: address }, newestId);
  }, [newestId, unlocked, address, markRead]);

  const mine = pendingMsg.filter((m) => m.to === address);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [friendMsg.length, mine.length]);

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
        <Unlock what={`you and ${name}`} />
      ) : (
        <>
          <div className="messages">
            {friendMsg.length === 0 && mine.length === 0 && (
              <p className="side-empty">
                No messages yet. Say hello; only you and {name} can read what you write.
              </p>
            )}
            <Bubbles
              messages={friendMsg}
              pending={mine}
              account={account}
              seenUpTo={theirRead}
              retryMessage={retryMessage}
              dismissMessage={dismissMessage}
            />
            <div ref={end} />
          </div>
          <Composer placeholder={`Message ${name}`} onSend={(msg) => sendMessage({ msg, address })} />
        </>
      )}
    </section>
  );
};

// The owner adds friends and removes members; removing starts a new room key.
const Members = ({ group }) => {
  const { friendLists, addMember, removeMember, busy, nameOf } = useContext(ChatAppContext);
  const [choice, setChoice] = useState("");
  const working = busy === "group";
  const addable = friendLists.filter((f) => !group.members.some((m) => same(m, f.address)));

  return (
    <div className="members" aria-label="Members">
      <ul className="member-list">
        {group.members.map((m) => (
          <li key={m} className="member">
            <Avatar name={nameOf(m)} address={m} size={28} />
            <span className="member-name">{nameOf(m)}</span>
            {same(m, group.owner) && <span className="tag">Owner</span>}
            {group.isOwner && !same(m, group.owner) && (
              <button
                type="button"
                className="btn btn-small"
                disabled={working}
                onClick={() => removeMember(group, m)}
                aria-label={`Remove ${nameOf(m)}`}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
      {group.isOwner && addable.length > 0 && (
        <form
          className="member-add"
          onSubmit={async (e) => {
            e.preventDefault();
            if (choice && (await addMember(group, choice))) setChoice("");
          }}
        >
          <label className="visually-hidden" htmlFor="add-member">
            Add a friend
          </label>
          <select id="add-member" className="input" value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">Add a friend</option>
            {addable.map((f) => (
              <option key={f.address} value={f.address}>
                {f.name}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-small" disabled={!choice || working}>
            Add
          </button>
        </form>
      )}
      <p className="members-note">
        {group.isOwner
          ? "A new member reads messages from now on. Removing someone starts a new room key they never receive."
          : "Only the owner can add or remove people."}
      </p>
    </div>
  );
};

const GroupConversation = ({ id }) => {
  const end = useRef(null);
  const [showMembers, setShowMembers] = useState(false);
  const {
    account,
    groups,
    groupMsg,
    pendingMsg,
    loadGroups,
    readGroupMessages,
    clearGroupThread,
    sendGroupMessage,
    retryMessage,
    dismissMessage,
    nameOf,
    unlocked,
    markRead,
  } = useContext(ChatAppContext);
  const group = groups.find((g) => g.id === id);
  const key = group ? `${group.id}:${group.version}` : "";
  const marked = useRef(0);

  useEffect(() => {
    marked.current = 0;
  }, [id]);

  const newestId = groupMsg.length ? groupMsg[groupMsg.length - 1].id : 0;
  useEffect(() => {
    if (!unlocked || !group || newestId <= marked.current) return;
    marked.current = newestId;
    markRead({ group: id }, newestId);
  }, [newestId, unlocked, group, id, markRead]);

  useEffect(() => {
    clearGroupThread();
    if (!unlocked) return undefined;
    // Reload the groups first so a new key version is known before decrypting.
    const refresh = async () => {
      await loadGroups();
      await readGroupMessages(id);
    };
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [id, unlocked, loadGroups, readGroupMessages, clearGroupThread]);

  const mine = pendingMsg.filter((m) => m.to === `group:${id}`);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [groupMsg.length, mine.length]);

  const title = group ? group.name : "Group";

  return (
    <section className="chat-main" aria-label={`Group ${title}`}>
      <div className="chat-head">
        <Link href="/" className="back" aria-label="Back to chats">
          <BackIcon />
        </Link>
        <Avatar name={title} address={`group-${id}`} size={36} />
        <div className="friend-text">
          <div className="friend-name">{title}</div>
          <div className="friend-address">{group ? `${group.members.length} members` : ""}</div>
        </div>
        {group && (
          <button
            type="button"
            className="btn btn-small head-action"
            aria-expanded={showMembers}
            onClick={() => setShowMembers((v) => !v)}
          >
            Members
          </button>
        )}
      </div>

      {!unlocked ? (
        <Unlock what="the people in this group" />
      ) : !group ? (
        <div className="messages">
          <div className="empty">
            <h2>Group not available</h2>
            <p>You are not in this group, or it does not exist.</p>
          </div>
        </div>
      ) : (
        <>
          {showMembers && <Members group={group} />}
          <div className="messages" key={key}>
            {groupMsg.length === 0 && mine.length === 0 && (
              <p className="side-empty">
                No messages yet. Everyone in the group shares one room key; the server cannot read it.
              </p>
            )}
            <Bubbles
              messages={groupMsg}
              pending={mine}
              account={account}
              labelFor={nameOf}
              retryMessage={retryMessage}
              dismissMessage={dismissMessage}
            />
            <div ref={end} />
          </div>
          <Composer
            placeholder={`Message ${title}`}
            onSend={(msg) => sendGroupMessage({ msg, groupId: id })}
          />
        </>
      )}
    </section>
  );
};

const Chat = () => {
  const { account, userName, ready, friendLists, people, connectWallet, connecting, groups, unlocked, unlock, unlocking, loadGroups, unread, refreshReads } =
    useContext(ChatAppContext);
  const [creating, setCreating] = useState(false);
  const incoming = people.filter((p) => p.relation === "incoming").length;
  const { query } = useRouter();
  const address = query.address || "";
  const name = query.name || "";
  const groupId = Number(query.group) || 0;

  // Being added to a group, or removed from one, shows up without a reload.
  useEffect(() => {
    if (!unlocked) return undefined;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") loadGroups();
    }, POLL_MS * 2);
    return () => clearInterval(timer);
  }, [unlocked, loadGroups]);

  // Unread counts need no unlock: the server counts ids and never reads a message.
  useEffect(() => {
    if (!account) return undefined;
    refreshReads();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refreshReads();
    }, POLL_MS * 2);
    return () => clearInterval(timer);
  }, [account, refreshReads]);

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

  const open = Boolean(address || groupId);

  return (
    <div className="page">
      <div className={`panel chat ${open ? "has-chat" : ""}`}>
        <aside className="chat-side" aria-label="Chats">
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
                    aria-current={address.toLowerCase() === f.address.toLowerCase()}
                    href={{ pathname: "/", query: { name: f.name, address: f.address } }}
                  >
                    <Avatar name={f.name} address={f.address} />
                    <span className="friend-text">
                      <span className="friend-name">{f.name}</span>
                      <span className="friend-address">{shortAddress(f.address)}</span>
                    </span>
                    <Unread count={unread.direct[f.address.toLowerCase()]} />
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

          <section className="group-section" aria-label="Groups">
            <div className="side-head">
              <h2 className="side-title">Groups</h2>
              {unlocked && friendLists.length > 0 && (
                <button type="button" className="btn btn-small" onClick={() => setCreating(true)}>
                  New group
                </button>
              )}
            </div>
            {!unlocked ? (
              <div className="side-empty">
                <p>Group names are encrypted, so unlock your messages to see yours.</p>
                <button type="button" className="btn btn-small" onClick={unlock} disabled={unlocking}>
                  {unlocking && <Spinner />}
                  {unlocking ? "Check MetaMask" : "Unlock"}
                </button>
              </div>
            ) : groups.length === 0 ? (
              <p className="side-empty">
                {friendLists.length === 0
                  ? "Add a friend first, then start a group."
                  : "No groups yet. Start one with the friends you pick."}
              </p>
            ) : (
              <ul className="friend-list">
                {groups.map((g) => (
                  <li key={g.id}>
                    <Link
                      className="friend"
                      aria-current={groupId === g.id}
                      href={{ pathname: "/", query: { group: g.id } }}
                    >
                      <Avatar name={g.name} address={`group-${g.id}`} />
                      <span className="friend-text">
                        <span className="friend-name">{g.name}</span>
                        <span className="friend-address">{g.members.length} members</span>
                      </span>
                      <Unread count={unread.groups[g.id]} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>

        {groupId ? (
          <GroupConversation key={`g${groupId}`} id={groupId} />
        ) : address ? (
          <Conversation key={address} name={name} address={address} />
        ) : (
          <div className="chat-main">
            <div className="empty">
              <h2>Pick a chat</h2>
              <p>Choose a friend or a group on the left to open the conversation.</p>
            </div>
          </div>
        )}
      </div>
      {creating && <GroupDialog onClose={() => setCreating(false)} />}
    </div>
  );
};

export default Chat;
