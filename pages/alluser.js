import React, { useContext } from "react";

import { ChatAppContext } from "../Context/ChatAppContext";
import { shortAddress } from "../Utils/apiFeature";
import { Avatar, EmptyState, Spinner } from "../Components/index";

const AllUser = () => {
  const { account, userName, ready, userLists, addFriends, busy } =
    useContext(ChatAppContext);

  if (!ready) return <div className="page" />;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Find people</h1>
        <p>Everyone registered on the contract who is not your friend yet.</p>
      </div>

      {!account || !userName ? (
        <EmptyState
          title="Sign in first"
          text="Connect your wallet and create an account to add friends."
        />
      ) : userLists.length === 0 ? (
        <EmptyState
          title="No one left to add"
          text="Everyone who has joined is already your friend. Ask someone to create an account."
        />
      ) : (
        <ul className="grid" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {userLists.map((u) => {
            const adding = busy === `friend:${u.accountAddress}`;
            return (
              <li key={u.accountAddress} className="panel person">
                <Avatar name={u.name} address={u.accountAddress} />
                <div className="friend-text">
                  <div className="friend-name">{u.name}</div>
                  <div className="friend-address" title={u.accountAddress}>
                    {shortAddress(u.accountAddress)}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    addFriends({ name: u.name, userAddress: u.accountAddress })
                  }
                >
                  {adding && <Spinner />}
                  {adding ? "Adding" : "Add friend"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default AllUser;
