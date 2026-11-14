// Abuse score from message metadata only: who wrote to whom, when, and how
// old the sender is. Ciphertext is never read, so privacy is unchanged.
//
// A message row is { sender, recipient, ts, firstTs }: ts is seconds, firstTs
// is the sender's first message ever (seconds), addresses lowercase.
const DAY = 86400;
const AGE_CAP_DAYS = 30;

// Per sender: [log peak messages in one minute, reciprocity, log distinct recipients, age].
// Every value is roughly 0..3 so one learning rate fits all of them.
function featuresBySender(messages, epochEnd) {
  const bySender = new Map();
  const wroteTo = new Set(messages.map((m) => `${m.sender}>${m.recipient}`));
  for (const m of messages) {
    if (!bySender.has(m.sender)) bySender.set(m.sender, []);
    bySender.get(m.sender).push(m);
  }
  const out = new Map();
  for (const [sender, rows] of bySender) {
    const perMinute = new Map();
    for (const r of rows) {
      const minute = Math.floor(r.ts / 60);
      perMinute.set(minute, (perMinute.get(minute) || 0) + 1);
    }
    const peak = Math.max(...perMinute.values());
    const answered = rows.filter((r) => wroteTo.has(`${r.recipient}>${sender}`)).length;
    const recipients = new Set(rows.map((r) => r.recipient)).size;
    const ageDays = Math.min(AGE_CAP_DAYS, Math.max(0, (epochEnd - rows[0].firstTs) / DAY));
    out.set(sender, [Math.log1p(peak), answered / rows.length, Math.log1p(recipients), ageDays / AGE_CAP_DAYS]);
  }
  return out;
}

const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const score = (model, x) => sigmoid(model.bias + x.reduce((s, v, i) => s + v * model.weights[i], 0));

// Logistic regression by batch gradient descent; no dependency, deterministic.
function train(xs, ys, { rounds = 3000, rate = 0.5 } = {}) {
  const model = { weights: xs[0].map(() => 0), bias: 0 };
  for (let r = 0; r < rounds; r++) {
    const grad = model.weights.map(() => 0);
    let gradBias = 0;
    xs.forEach((x, i) => {
      const err = score(model, x) - ys[i];
      x.forEach((v, j) => (grad[j] += err * v));
      gradBias += err;
    });
    model.weights = model.weights.map((w, j) => w - (rate * grad[j]) / xs.length);
    model.bias -= (rate * gradBias) / xs.length;
  }
  return model;
}

// Senders scoring at or above the threshold; the mining batch skips them.
function flaggedSenders(messages, epochEnd, model, threshold = 0.5) {
  const flagged = new Set();
  for (const [sender, x] of featuresBySender(messages, epochEnd)) {
    if (score(model, x) >= threshold) flagged.add(sender);
  }
  return flagged;
}

module.exports = { featuresBySender, score, train, flaggedSenders, DAY };
