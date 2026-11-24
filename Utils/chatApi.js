import { SiweMessage } from "siwe";

import { NETWORK } from "../Context/config";

// Calls to the site's own API (pages/api). The session lives in an HttpOnly
// cookie, so nothing here stores a token.
const call = async (method, path, body) => {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const error = new Error(json?.error?.message || `Request failed (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return json;
};

export const getSession = async () => {
  try {
    return (await call("GET", "/api/auth/session")).address;
  } catch (error) {
    if (error.status === 401) return "";
    throw error;
  }
};

// Sign-In with Ethereum: fetch a nonce, have the wallet sign the message,
// let the server verify it and set the cookie.
export const signIn = async (address, sign) => {
  const { nonce } = await call("GET", "/api/auth/nonce");
  const message = new SiweMessage({
    domain: window.location.host,
    address,
    statement: "Sign in to Node Connect",
    uri: window.location.origin,
    version: "1",
    chainId: parseInt(NETWORK.chainId, 16),
    nonce,
  }).prepareMessage();
  const signature = await sign(message);
  return (await call("POST", "/api/auth/verify", { message, signature })).address;
};

export const sendCiphertext = (recipient, ciphertext) =>
  call("POST", "/api/messages", { recipient, ciphertext }).then((r) => r.message);

export const listGroups = () => call("GET", "/api/groups").then((r) => r.groups);

export const createGroupRoom = (keys) => call("POST", "/api/groups", { keys }).then((r) => r.group);

export const addGroupMember = (group, member, wrapped) =>
  call("POST", "/api/groups/members", { group, member, wrapped });

export const removeGroupMember = (group, member, keys) =>
  call("DELETE", "/api/groups/members", { group, member, keys });

export const sendGroupCiphertext = (group, version, ciphertext) =>
  call("POST", "/api/groups/messages", { group, version, ciphertext }).then((r) => r.message);

export const listGroupThread = (group, limit = 100) =>
  call("GET", `/api/groups/messages?group=${group}&limit=${limit}`).then((r) => r.messages);

export const getReads = (peer) =>
  call("GET", peer ? `/api/reads?with=${peer}` : "/api/reads");

export const markReadUpTo = (target, upTo) => call("POST", "/api/reads", { ...target, upTo });

export const listThread = (other, limit = 100) =>
  call("GET", `/api/messages?with=${other}&limit=${limit}`).then((r) => r.messages);
