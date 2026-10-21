import React, { useContext } from "react";

import { ChatAppContext } from "../Context/ChatAppContext";
import { Avatar, EmptyState } from "../Components/index";

const Leaderboard = () => {
  const { account, ready, userListsforleaderboard } = useContext(ChatAppContext);

  if (!ready) return <div className="page" />;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Leaderboard</h1>
        <p>Everyone ranked by the reward tokens they have earned.</p>
      </div>

      {userListsforleaderboard.length === 0 ? (
        <EmptyState
          title="Nobody here yet"
          text={
            account
              ? "No account has been created on the contract."
              : "Connect your wallet to read the rankings from the contract."
          }
        />
      ) : (
        <div className="panel">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Name</th>
                <th scope="col" className="num">
                  Tokens
                </th>
              </tr>
            </thead>
            <tbody>
              {userListsforleaderboard.map((u, i) => (
                <tr key={u.accountAddress}>
                  <td>{i + 1}</td>
                  <td>
                    <span className="who">
                      <Avatar name={u.name} address={u.accountAddress} size={28} />
                      {u.name}
                    </span>
                  </td>
                  <td className="num">{u.tokens}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default Leaderboard;
