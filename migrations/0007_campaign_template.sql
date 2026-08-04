-- A campaign's "angle" was a description of what you'd say, which nothing
-- could act on — the message shown in the daily queue still came from a
-- generic template, so a Kompany campaign offered a cerver pitch. The
-- campaign now carries the message itself, with {first}/{company}/{title}
-- filled in per person.
ALTER TABLE lists ADD COLUMN template TEXT;
UPDATE lists SET template = angle WHERE angle IS NOT NULL AND template IS NULL;
ALTER TABLE lists DROP COLUMN angle;
