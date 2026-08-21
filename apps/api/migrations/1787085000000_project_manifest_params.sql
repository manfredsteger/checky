-- Up Migration

ALTER TABLE projects ADD COLUMN manifest_id TEXT;                       -- Tracking-Typ (flight/heizoel/generic)
ALTER TABLE projects ADD COLUMN params JSONB NOT NULL DEFAULT '{}'::jsonb; -- gemeinsame Parameter aller Agenten des Projekts

-- Down Migration

ALTER TABLE projects DROP COLUMN params;
ALTER TABLE projects DROP COLUMN manifest_id;
