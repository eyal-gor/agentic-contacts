-- Contact photo. A small data-URL (client downscales to ~128px before
-- saving) or a plain https URL — either way it's just text in the row.
ALTER TABLE contacts ADD COLUMN image TEXT;
