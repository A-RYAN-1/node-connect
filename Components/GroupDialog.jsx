import React, { useState, useContext, useEffect, useRef } from "react";

import { ChatAppContext } from "../Context/ChatAppContext";
import Avatar from "./Avatar";
import Spinner from "./Spinner";

const MAX_MEMBERS = 20;

const GroupDialog = ({ onClose }) => {
  const [name, setName] = useState("");
  const [picked, setPicked] = useState([]);
  const { createGroup, busy, friendLists } = useContext(ChatAppContext);
  const working = busy === "group";
  const input = useRef(null);

  useEffect(() => {
    input.current?.focus();
    const onKey = (e) => e.key === "Escape" && !working && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, working]);

  const toggle = (address) =>
    setPicked((list) =>
      list.includes(address) ? list.filter((a) => a !== address) : [...list, address]
    );

  const submit = async (e) => {
    e.preventDefault();
    if (await createGroup({ name, members: picked })) onClose();
  };

  return (
    <div className="scrim">
      <form
        className="panel dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-title"
        onSubmit={submit}
      >
        <h2 id="group-title">New group</h2>
        <p>
          You make one room key in your browser and lock a copy for each friend you pick. The
          server stores only the locked copies and encrypted messages, so it cannot read the
          group name or anything said in it. You can add or remove friends later.
        </p>
        <div className="field">
          <label htmlFor="group-name">Group name</label>
          <input
            id="group-name"
            ref={input}
            className="input"
            value={name}
            maxLength={40}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <fieldset className="pick-list">
          <legend>Friends to add (up to {MAX_MEMBERS - 1})</legend>
          {friendLists.length === 0 && <p>You have no friends yet.</p>}
          {friendLists.map((f) => (
            <label key={f.address} className="pick">
              <input
                type="checkbox"
                checked={picked.includes(f.address)}
                disabled={!picked.includes(f.address) && picked.length >= MAX_MEMBERS - 1}
                onChange={() => toggle(f.address)}
              />
              <Avatar name={f.name} address={f.address} size={28} />
              <span>{f.name}</span>
            </label>
          ))}
        </fieldset>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose} disabled={working}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={working || !name.trim() || picked.length === 0}
          >
            {working && <Spinner />}
            {working ? "Creating" : "Create group"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default GroupDialog;
