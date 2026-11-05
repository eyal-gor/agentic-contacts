-- Duplicate detection + a real primary email (ideas borrowed from Twenty CRM).
--
-- primaryEmail: the contact's main address, kept equal to emails[0] by the
-- store. Indexed so "who is ada@x.com?" is one lookup, not a LIKE over JSON.
ALTER TABLE contacts ADD COLUMN primaryEmail TEXT;
UPDATE contacts SET primaryEmail = lower(json_extract(emails, '$[0]'))
  WHERE json_valid(emails) AND json_array_length(emails) > 0;
CREATE INDEX IF NOT EXISTS idx_contacts_primary_email ON contacts (primaryEmail);

-- match_keys: every normalized value a record can be matched on, one row each.
-- kind: email | linkedin | name | domain. A contact gets a row per email
-- (primary and additional), its LinkedIn slug and its folded name; a company
-- gets its folded name and every domain. Two records sharing a (kind, value)
-- are duplicate candidates. Twenty does the same with per-object
-- duplicateCriteria over unique columns; a side table is the SQLite-friendly
-- way to cover array fields like emails[].
--
-- The app fills this table (normalization lives in src/keys.ts, not SQL);
-- it rebuilds itself on first use when empty, and POST /maintenance/reindex
-- rebuilds it on demand.
CREATE TABLE IF NOT EXISTS match_keys (
  entity    TEXT NOT NULL,          -- contact | company
  entityId  TEXT NOT NULL,
  kind      TEXT NOT NULL,
  value     TEXT NOT NULL,
  PRIMARY KEY (entity, entityId, kind, value)
);
CREATE INDEX IF NOT EXISTS idx_match_keys_lookup ON match_keys (entity, kind, value);
