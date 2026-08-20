-- Up Migration

CREATE TABLE settings (
    key VARCHAR(255) PRIMARY KEY,
    value JSONB NOT NULL
);

-- Down Migration

DROP TABLE settings;
