-- Up Migration
-- API-Quellen (kind:api): Agent verweist auf einen Provider-Adapter statt auf ein Recipe.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS provider TEXT;

-- Down Migration
-- ALTER TABLE agents DROP COLUMN IF EXISTS provider;
