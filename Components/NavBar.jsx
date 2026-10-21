import React, { useState, useContext } from "react";
import Link from "next/link";
import { useRouter } from "next/router";

import { ChatAppContext } from "../Context/ChatAppContext";
import { shortAddress } from "../Utils/apiFeature";
import Avatar from "./Avatar";
import AccountDialog from "./AccountDialog";
import Notice from "./Notice";
import Spinner from "./Spinner";

const links = [
  { label: "Chat", href: "/" },
  { label: "Find people", href: "/alluser" },
  { label: "Leaderboard", href: "/leaderboard" },
];

const Mark = () => (
  <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
    <circle cx="6" cy="13" r="3" fill="currentColor" />
    <circle cx="20" cy="6" r="3" fill="currentColor" />
    <circle cx="20" cy="20" r="3" fill="currentColor" />
    <path d="M8.6 11.6 17.4 7.4M8.6 14.4l8.8 4.2" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);

const NavBar = () => {
  const [creating, setCreating] = useState(false);
  const { pathname } = useRouter();
  const {
    account,
    userName,
    connectWallet,
    connecting,
    error,
    clearError,
    tokenBalance,
  } = useContext(ChatAppContext);

  return (
    <header className="header">
      <div className="header-inner">
        <Link href="/" className="brand">
          <Mark />
          Node Connect
        </Link>

        <nav className="nav" aria-label="Main">
          {links.map(({ label, href }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="wallet">
          {!account ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={connectWallet}
              disabled={connecting}
            >
              {connecting && <Spinner />}
              {connecting ? "Check MetaMask" : "Connect wallet"}
            </button>
          ) : (
            <>
              <span className="chip chip-balance" title="Reward tokens earned">
                {tokenBalance} TOK
              </span>
              {userName ? (
                <span className="chip" title={account}>
                  <Avatar name={userName} address={account} size={22} />
                  <span className="chip-name">{userName}</span>
                </span>
              ) : (
                <button
                  type="button"
                  className="btn btn-small btn-primary"
                  onClick={() => setCreating(true)}
                >
                  Create account
                </button>
              )}
              <span className="mono" title={account}>
                {shortAddress(account)}
              </span>
            </>
          )}
        </div>
      </div>

      {creating && <AccountDialog onClose={() => setCreating(false)} />}
      {error && <Notice message={error} onClose={clearError} />}
    </header>
  );
};

export default NavBar;
