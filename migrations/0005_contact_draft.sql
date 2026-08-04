-- The message waiting to be sent to this person.
--
-- Drafts used to be computed from a template when the outreach screen
-- painted, so they couldn't be edited, reviewed, improved by anything that
-- had read the person's history, or survive a refresh. Storing one per
-- contact gives an agent somewhere to write and the daily queue something
-- to show.
ALTER TABLE contacts ADD COLUMN draft TEXT;
