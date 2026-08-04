-- Named API keys, minted and revoked from the Settings screen. Only the
-- SHA-256 of a key is stored — the plaintext is shown once at mint time.
-- The env API_KEY secret keeps working alongside these (handset and the
-- Secrets Store bind it); rows here are the keys humans can see and manage.
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  keyHash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  lastUsedAt TEXT,
  revokedAt TEXT
);
