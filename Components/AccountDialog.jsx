import React, { useState, useContext, useEffect, useRef } from "react";

import { ChatAppContext } from "../Context/ChatAppContext";
import Spinner from "./Spinner";

const AccountDialog = ({ onClose }) => {
  const [name, setName] = useState("");
  const { createAccount, busy } = useContext(ChatAppContext);
  const working = busy === "account";
  const input = useRef(null);

  useEffect(() => {
    input.current?.focus();
    const onKey = (e) => e.key === "Escape" && !working && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, working]);

  const submit = async (e) => {
    e.preventDefault();
    if (await createAccount({ name })) onClose();
  };

  return (
    <div className="scrim">
      <form
        className="panel dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-title"
        onSubmit={submit}
      >
        <h2 id="account-title">Create your account</h2>
        <p>
          Pick the name your friends will see. It is stored on the chain, so
          MetaMask will ask you to confirm one transaction.
        </p>
        <div className="field">
          <label htmlFor="account-name">Name</label>
          <input
            id="account-name"
            ref={input}
            className="input"
            value={name}
            maxLength={32}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose} disabled={working}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={working || !name.trim()}
          >
            {working && <Spinner />}
            {working ? "Waiting for the network" : "Create account"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default AccountDialog;
