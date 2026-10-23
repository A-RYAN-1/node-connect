// Writes the ABIs the frontend uses (Registry and NodeToken) into Context/ so
// the site always matches contracts/. Run with `npm run abi`.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const contracts = ["Registry", "NodeToken"];

for (const name of contracts) {
  const source = path.join(root, `artifacts/contracts/${name}.sol/${name}.json`);
  const target = path.join(root, `Context/${name}.json`);
  const { abi } = JSON.parse(fs.readFileSync(source, "utf8"));
  fs.writeFileSync(target, `${JSON.stringify({ abi }, null, 2)}
`);
  console.log(`Wrote the ABI of ${name} to ${path.relative(root, target)}`);
}
