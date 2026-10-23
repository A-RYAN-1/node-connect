import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  globalIgnores([".next/**", "out/**", "artifacts/**", "cache/**", "node_modules/**"]),
  {
    // Hardhat config, scripts and tests run in Node with CommonJS
    files: ["hardhat.config.js", "scripts/**", "test/**", "next.config.js", "lib/server/**"],
    languageOptions: { sourceType: "commonjs" },
  },
]);
