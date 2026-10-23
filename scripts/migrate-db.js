require("dotenv").config();
const { neon } = require("@neondatabase/serverless");
const { statements } = require("../lib/server/schema");

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const sql = neon(process.env.DATABASE_URL);
  for (const statement of statements) await sql.query(statement);
  console.log(`Applied ${statements.length} statements`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
