-- Up Migration

ALTER TABLE recorder_sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'auto';   -- auto | assisted
ALTER TABLE recorder_sessions ADD COLUMN pending_instruction TEXT;             -- nächste Nutzer-Anweisung (assisted)

-- Down Migration

ALTER TABLE recorder_sessions DROP COLUMN pending_instruction;
ALTER TABLE recorder_sessions DROP COLUMN mode;
