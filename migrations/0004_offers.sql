-- Offers: what you're selling someone ("Cerver for agencies: a computer per
-- client"). Picked when you reach out; the contact carries `offer:<id>`.
-- Shared by the LinkedIn extension, the app and the CLI.
CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pitch TEXT NOT NULL DEFAULT '',
  icp TEXT,
  uses INTEGER NOT NULL DEFAULT 0,
  lastUsedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
