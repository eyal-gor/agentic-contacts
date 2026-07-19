-- Agentic Contacts — initial schema.
--
-- Mirrors the shapes in src/schema.ts. Array fields (emails, phones, tags,
-- domains) are JSON text: the app treats them as opaque lists, and SQLite has
-- no array type. Timestamps are ISO strings, as the API already returns them.

CREATE TABLE IF NOT EXISTS contacts (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  emails        TEXT NOT NULL DEFAULT '[]',
  phones        TEXT NOT NULL DEFAULT '[]',
  companyId     TEXT,
  company       TEXT,
  title         TEXT,
  tags          TEXT NOT NULL DEFAULT '[]',
  notes         TEXT,
  linkedin      TEXT,
  followUpAt    TEXT,
  followUpNote  TEXT,
  createdAt     TEXT NOT NULL,
  updatedAt     TEXT NOT NULL
);

-- `due=` queries sort and filter on followUpAt; list views hit name.
CREATE INDEX IF NOT EXISTS idx_contacts_followup ON contacts (followUpAt);
CREATE INDEX IF NOT EXISTS idx_contacts_name     ON contacts (name);
CREATE INDEX IF NOT EXISTS idx_contacts_company  ON contacts (companyId);

CREATE TABLE IF NOT EXISTS companies (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  website         TEXT,
  domains         TEXT NOT NULL DEFAULT '[]',
  tags            TEXT NOT NULL DEFAULT '[]',
  notes           TEXT,
  status          TEXT,
  sourceUrl       TEXT,
  fitReason       TEXT,
  suggestedAngle  TEXT,
  confidence      TEXT,
  createdAt       TEXT NOT NULL,
  updatedAt       TEXT NOT NULL
);

-- upsertByName matches case-insensitively, so index the folded name.
CREATE INDEX IF NOT EXISTS idx_companies_name ON companies (lower(name));

CREATE TABLE IF NOT EXISTS lists (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  createdAt  TEXT NOT NULL,
  updatedAt  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS interactions (
  id          TEXT PRIMARY KEY,
  contactId   TEXT NOT NULL,
  channel     TEXT NOT NULL,
  summary     TEXT NOT NULL,
  occurredAt  TEXT NOT NULL,
  createdAt   TEXT NOT NULL
);

-- Every read is "history for this contact", newest first.
CREATE INDEX IF NOT EXISTS idx_interactions_contact ON interactions (contactId, occurredAt DESC);
