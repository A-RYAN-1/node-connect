// Seeded simulated population for training and measuring the abuse score.
// The shapes below are assumptions, not data from real users: the measured
// numbers say how well the score separates THESE simulated behaviours.
const { DAY } = require("./abuse");

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const addr = (n) => "0x" + n.toString(16).padStart(40, "0");

// One epoch (a day) ending at DAY. Returns { messages, labels, epochEnd }
// where labels maps sender -> 1 for farming accounts and 0 for honest ones.
function simulate(seed, { honest = 300, farmers = 80 } = {}) {
  const rand = rng(seed);
  const between = (lo, hi) => lo + rand() * (hi - lo);
  const int = (lo, hi) => Math.floor(between(lo, hi + 1));
  const messages = [];
  const labels = new Map();
  const firstTs = new Map();
  let next = 1;
  const account = (label, ageDays) => {
    const a = addr(next++);
    labels.set(a, label);
    firstTs.set(a, DAY - ageDays * DAY);
    return a;
  };
  const say = (from, to, ts) => messages.push({ sender: from, recipient: to, ts, firstTs: 0 });

  // Honest: a few friends, short chatty sessions, most friends reply, some
  // users only listen or send once (low reciprocity), many are new.
  const people = Array.from({ length: honest }, () => account(0, between(0, 200)));
  for (const p of people) {
    for (let f = int(1, 4); f > 0; f--) {
      const friend = people[int(0, people.length - 1)];
      if (friend === p) continue;
      const start = between(0, DAY - 3600);
      const replies = rand() < 0.75;
      for (let i = int(3, 18); i > 0; i--) {
        const ts = start + between(0, 3600);
        say(p, friend, ts);
        if (replies && rand() < 0.8) say(friend, p, ts + between(5, 120));
      }
    }
  }

  // Farmers, three styles: rings of fresh accounts trading just over the
  // payout minimum in a burst (reciprocal, so reciprocity alone passes them),
  // aged rings that behave the same, and one-way blasters at honest users.
  for (let i = 0; i < farmers; ) {
    const style = rand();
    const age = style < 0.5 ? between(0, 3) : style < 0.8 ? between(10, 60) : between(0, 5);
    const ring = Array.from({ length: Math.min(int(2, 4), farmers - i) }, () => account(1, age));
    i += ring.length;
    const burst = between(0, DAY - 600);
    for (const a of ring) {
      const targets = style < 0.8 ? ring.filter((b) => b !== a) : [people[int(0, people.length - 1)]];
      for (const b of targets) {
        for (let k = int(5, 9); k > 0; k--) say(a, b, burst + between(0, style < 0.8 ? 90 : 300));
      }
    }
  }

  for (const m of messages) m.firstTs = Math.min(firstTs.get(m.sender), m.ts);
  messages.sort((a, b) => a.ts - b.ts);
  return { messages, labels, epochEnd: DAY };
}

module.exports = { simulate };
