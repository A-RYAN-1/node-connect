import React, { useContext } from "react";

import { ChatAppContext } from "../Context/ChatAppContext";
import { shortAddress } from "../Utils/apiFeature";
import { Avatar, EmptyState, Spinner } from "../Components/index";

const actionsFor = (person, { busy, requestFriend, acceptFriend, declineFriend }) => {
  const working = busy === `friend:${person.address}`;
  const spinner = working && <Spinner />;
  if (person.relation === "incoming") {
    return (
      <span className="actions">
        <button
          type="button"
          className="btn btn-small btn-primary"
          disabled={Boolean(busy)}
          onClick={() => acceptFriend(person.address, person.name)}
        >
          {spinner}Accept
        </button>
        <button
          type="button"
          className="btn btn-small"
          disabled={Boolean(busy)}
          onClick={() => declineFriend(person.address)}
        >
          Decline
        </button>
      </span>
    );
  }
  if (person.relation === "outgoing") {
    return <span className="chip">Request sent</span>;
  }
  return (
    <button
      type="button"
      className="btn btn-small"
      disabled={Boolean(busy)}
      onClick={() => requestFriend(person.address)}
    >
      {spinner}
      {working ? "Sending request" : "Send request"}
    </button>
  );
};

const AllUser = () => {
  const chat = useContext(ChatAppContext);
  const { account, userName, ready, people } = chat;

  if (!ready) return <div className="page" />;

  const others = people.filter((p) => p.relation !== "friend");
  // Requests that wait for you come first.
  const rank = { incoming: 0, none: 1, outgoing: 2 };
  others.sort((a, b) => rank[a.relation] - rank[b.relation]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Find people</h1>
        <p>
          Everyone registered on the contract who is not your friend yet. You
          can message someone once they accept your request.
        </p>
      </div>

      {!account || !userName ? (
        <EmptyState
          title="Sign in first"
          text="Connect your wallet and create an account to add friends."
        />
      ) : others.length === 0 ? (
        <EmptyState
          title="No one left to add"
          text="Everyone who has joined is already your friend. Ask someone to create an account."
        />
      ) : (
        <ul className="grid" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {others.map((u) => (
            <li key={u.address} className="panel person">
              <Avatar name={u.name} address={u.address} />
              <div className="friend-text">
                <div className="friend-name">{u.name}</div>
                <div className="friend-address" title={u.address}>
                  {shortAddress(u.address)}
                  {u.relation === "incoming" && " wants to be your friend"}
                </div>
              </div>
              {actionsFor(u, chat)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default AllUser;
