const { test } = require("node:test");
const assert = require("node:assert/strict");
const { featuresBySender, flaggedSenders, score, DAY } = require("../lib/server/abuse");
const { simulate } = require("../lib/server/abuseSim");
const { buildBatch } = require("../lib/server/activity");
const model = require("../lib/server/abuseModel.json");

const [a, b, c] = ["a", "b", "c"].map((ch) => "0x" + ch.repeat(40));
const row = (sender, recipient, ts, firstTs = 0) => ({ sender, recipient, ts, firstTs });

test("features: peak per minute, reciprocity, recipients and age", () => {
  const messages = [row(a, b, 10), row(a, b, 20), row(a, c, 4000), row(b, a, 30)];
  const [peak, reciprocity, recipients, age] = featuresBySender(messages, DAY * 30).get(a);
  assert.equal(peak, Math.log1p(2));
  assert.equal(reciprocity, 2 / 3);
  assert.equal(recipients, Math.log1p(2));
  assert.equal(age, 1);
});

test("a fresh reciprocal ring in a burst is flagged, a paced pair of old accounts is not", () => {
  const ring = [];
  for (let i = 0; i < 6; i++) ring.push(row(a, b, DAY - 500 + i), row(b, a, DAY - 495 + i));
  assert.deepEqual([...flaggedSenders(ring, DAY, model)].sort(), [a, b]);

  const pair = [];
  for (let i = 0; i < 6; i++) pair.push(row(a, b, i * 600), row(b, a, i * 600 + 60));
  const old = pair.map((m) => ({ ...m, firstTs: -100 * DAY }));
  assert.equal(flaggedSenders(old, DAY, model).size, 0);
});

test("buildBatch leaves out flagged senders", () => {
  const rows = [
    { sender: a, recipient: b, count: 6 },
    { sender: b, recipient: a, count: 6 },
  ];
  assert.equal(buildBatch(rows).leaves.length, 2);
  assert.deepEqual(buildBatch(rows, 5, new Set([a])).leaves, [[b, a, "6"]]);
  assert.equal(buildBatch(rows, 5, new Set([a, b])), null);
});

test("on a population it was not trained on, the saved model finds the farms and beats reciprocity alone", () => {
  const { messages, labels, epochEnd } = simulate(777);
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let baselineTp = 0;
  for (const [sender, x] of featuresBySender(messages, epochEnd)) {
    const farming = labels.get(sender) === 1;
    const flagged = score(model, x) >= 0.5;
    if (flagged && farming) tp++;
    else if (flagged) fp++;
    else if (farming) fn++;
    if (x[1] < 0.5 && farming) baselineTp++;
  }
  assert.ok(tp / (tp + fp) > 0.95, `precision ${tp / (tp + fp)}`);
  assert.ok(tp / (tp + fn) > 0.95, `recall ${tp / (tp + fn)}`);
  assert.ok(tp > baselineTp * 2, "model should find far more farming senders than the reciprocity rule");
});

test("the simulation is repeatable from its seed", () => {
  assert.deepEqual(simulate(5).messages, simulate(5).messages);
});
