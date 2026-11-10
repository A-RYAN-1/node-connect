import { solve } from "./pow";

// Runs the proof of work off the main thread. Message in: { root, user,
// target } (strings). Messages out: { progress: attempts } and then
// { nonce: string } or { error: string }.
self.onmessage = (event) => {
  const { root, user, target } = event.data;
  try {
    const nonce = solve(root, user, BigInt(target), {
      onProgress: (attempts) => self.postMessage({ progress: attempts.toString() }),
    });
    self.postMessage(nonce === null ? { error: "No solution found" } : { nonce: nonce.toString() });
  } catch (error) {
    self.postMessage({ error: String(error && error.message) });
  }
};
