import React, { useContext, useEffect, useState } from "react";

import { ChatAppContext } from "../Context/ChatAppContext";
import { EmptyState, Spinner } from "../Components/index";
import { loadClaims, loadEpochState, solveWork, sendClaim } from "../Utils/mining";

const tokens = (wei) => String(Number(wei / 10n ** 18n));

const Mine = () => {
  const { account, ready, unlocked, unlocking, unlock, userName } = useContext(ChatAppContext);
  const [claims, setClaims] = useState(null);
  const [state, setState] = useState(null);
  const [step, setStep] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!unlocked || !account) return;
    let cancelled = false;
    (async () => {
      try {
        const found = await loadClaims();
        const epochState = await loadEpochState(found.epoch, account);
        if (!cancelled) {
          setClaims(found);
          setState(epochState);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, account, message]);

  const best =
    claims && claims.entries.length > 0
      ? claims.entries.reduce((a, b) => (b.messageCount > a.messageCount ? b : a))
      : null;

  const run = async () => {
    setError("");
    setMessage("");
    try {
      setStep("work");
      setAttempts(0);
      const nonce = await solveWork(claims.root, account, state.target, setAttempts);
      setStep("claim");
      await sendClaim(claims.epoch, best, nonce);
      setMessage(`Claimed ${tokens(state.reward)} TOK for day ${claims.epoch}.`);
    } catch (err) {
      setError(err?.shortMessage || err?.message || "The claim failed");
    } finally {
      setStep("");
    }
  };

  if (!ready) return <div className="page" />;

  let body = null;
  if (!account) {
    body = (
      <EmptyState
        title="Connect your wallet"
        text="Mining pays tokens for conversations, so the site needs to know who you are."
      />
    );
  } else if (!unlocked) {
    body = (
      <EmptyState
        title="Sign in to see your claims"
        text="One signature proves the address is yours. Nothing is sent to the chain."
      >
        <button type="button" className="btn btn-primary" onClick={unlock} disabled={unlocking}>
          {unlocking && <Spinner />}Sign in
        </button>
      </EmptyState>
    );
  } else if (!claims || !state) {
    if (!error) {
      body = (
        <div className="panel mine-panel">
          <span>Checking the last day of activity</span>
        </div>
      );
    }
  } else {
    let status;
    if (state.claimed) status = "You already claimed this day.";
    else if (!best) status = "No claim yet. Send at least 5 messages to a friend who writes back during one day and it appears the next day.";
    else if (!claims.anchored) status = "Your activity counts, but the day has not been posted to the chain yet. That happens once a day, shortly after midnight UTC.";
    else if (state.full) status = "All claims for this day are taken.";
    else status = `Ready: ${best.messageCount} messages counted with a friend.`;
    const canClaim = best && claims.anchored && !state.claimed && !state.full;
    let label = "Mine and claim";
    if (step === "work") label = `Mining, ${attempts.toLocaleString()} tries`;
    if (step === "claim") label = "Confirm in your wallet";
    body = (
      <div className="panel mine-panel">
        <dl className="mine-facts">
          <div>
            <dt>Day</dt>
            <dd>{claims.epoch}</dd>
          </div>
          <div>
            <dt>Reward</dt>
            <dd>{tokens(state.reward)} TOK</dd>
          </div>
          <div>
            <dt>Claims so far</dt>
            <dd>{String(state.claims)}</dd>
          </div>
        </dl>
        <p role="status">{status}</p>
        {canClaim && (
          <button type="button" className="btn btn-primary" disabled={Boolean(step)} onClick={run}>
            {step && <Spinner />}
            {label}
          </button>
        )}
        {message && (
          <p className="mine-done" role="status">
            {message}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Mine</h1>
        <p>
          {userName ? `${userName}, each` : "Each"} day you earn tokens for real conversations: at least 5 messages to a
          friend who wrote back. Your browser solves a small puzzle, then you confirm one transaction.
        </p>
      </div>
      {body}
      {error && (
        <p className="mine-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};

export default Mine;
