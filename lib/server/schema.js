const statements = [
  `CREATE TABLE IF NOT EXISTS nonces (
     nonce text PRIMARY KEY,
     expires_at timestamptz NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS messages (
     id bigserial PRIMARY KEY,
     sender char(42) NOT NULL,
     recipient char(42) NOT NULL,
     ciphertext text NOT NULL,
     epoch integer NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS messages_pair_idx
     ON messages (LEAST(sender, recipient), GREATEST(sender, recipient), id DESC)`,
  `CREATE INDEX IF NOT EXISTS messages_sender_created_idx
     ON messages (sender, created_at DESC)`,
];

module.exports = { statements };
