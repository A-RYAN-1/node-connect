// Trains the abuse score on one simulated population and measures it, next to
// a reciprocity-only baseline, on populations it has never seen.
//   node scripts/abuse-eval.js           print the numbers
//   node scripts/abuse-eval.js --write   also save the weights to abuseModel.json
const fs = require("node:fs");
const path = require("node:path");
const { featuresBySender, score, train } = require("../lib/server/abuse");
const { simulate } = require("../lib/server/abuseSim");

const TRAIN_SEED = 1;
const TEST_SEEDS = [101, 102, 103, 104, 105];
const THRESHOLD = 0.5;

function dataset(seed) {
  const { messages, labels, epochEnd } = simulate(seed);
  const xs = [];
  const ys = [];
  for (const [sender, x] of featuresBySender(messages, epochEnd)) {
    xs.push(x);
    ys.push(labels.get(sender));
  }
  return { xs, ys };
}

function rates(flags, ys) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  flags.forEach((f, i) => {
    if (f && ys[i]) tp++;
    else if (f) fp++;
    else if (ys[i]) fn++;
  });
  return { precision: tp / (tp + fp || 1), recall: tp / (tp + fn || 1), falseFlags: fp };
}

const trainSet = dataset(TRAIN_SEED);
const model = train(trainSet.xs, trainSet.ys);
const test = TEST_SEEDS.map(dataset);
const all = { xs: test.flatMap((d) => d.xs), ys: test.flatMap((d) => d.ys) };

const learned = rates(all.xs.map((x) => score(model, x) >= THRESHOLD), all.ys);
// Baseline: flag a sender nobody answers, the one signal the mining batch already uses.
const baseline = rates(all.xs.map((x) => x[1] < 0.5), all.ys);
const show = (name, r) =>
  console.log(`${name.padEnd(9)} precision ${r.precision.toFixed(3)}  recall ${r.recall.toFixed(3)}  honest senders flagged ${r.falseFlags}`);
console.log(
  `trained on seed ${TRAIN_SEED}; tested on ${all.ys.length} senders from seeds ${TEST_SEEDS.join(", ")} (${all.ys.filter(Boolean).length} farming)`
);
show("baseline", baseline);
show("learned", learned);
console.log("weights", model.weights.map((w) => w.toFixed(3)).join(", "), "bias", model.bias.toFixed(3));

if (process.argv.includes("--write")) {
  const features = ["log1p peak per minute", "reciprocity", "log1p distinct recipients", "age over 30 days"];
  fs.writeFileSync(path.join(__dirname, "../lib/server/abuseModel.json"), JSON.stringify({ features, ...model }, null, 2) + "\n");
}
