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
  // Group chats. The server holds the owner, a key version, one wrapped copy of
  // the room key per member and version, and ciphertext. Names and keys are
  // inside the wrapped copies, so the server cannot read either.
  `CREATE TABLE IF NOT EXISTS groups (
     id bigserial PRIMARY KEY,
     owner char(42) NOT NULL,
     key_version integer NOT NULL DEFAULT 1,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS group_keys (
     group_id bigint NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
     version integer NOT NULL,
     member char(42) NOT NULL,
     wrapped text NOT NULL,
     PRIMARY KEY (group_id, version, member)
   )`,
  `CREATE INDEX IF NOT EXISTS group_keys_member_idx ON group_keys (member)`,
  `CREATE TABLE IF NOT EXISTS group_messages (
     id bigserial PRIMARY KEY,
     group_id bigint NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
     sender char(42) NOT NULL,
     version integer NOT NULL,
     ciphertext text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS group_messages_group_idx ON group_messages (group_id, id DESC)`,
  `CREATE INDEX IF NOT EXISTS group_messages_sender_created_idx
     ON group_messages (sender, created_at DESC)`,
  // Read marks: the id of the last message a person has seen in one chat. Ids and
  // addresses only, never content. chat is the other person's address or "group:<id>".
  `CREATE TABLE IF NOT EXISTS read_marks (
     reader char(42) NOT NULL,
     chat text NOT NULL,
     last_read bigint NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (reader, chat)
   )`,
];

module.exports = { statements };
