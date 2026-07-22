-- Provenance: who created each record — a person ("Eyal (person)"), a
-- Kompany system ("Contact Keeper (system)"), or an agent. Set on create,
-- never overwritten by upserts. createdAt already answers "when".
ALTER TABLE companies ADD COLUMN addedBy TEXT;
ALTER TABLE contacts ADD COLUMN addedBy TEXT;
