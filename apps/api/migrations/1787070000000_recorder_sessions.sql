-- Up Migration

CREATE TABLE recorder_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'running',   -- running | awaiting_confirm | completed | aborted | failed
    events JSONB NOT NULL DEFAULT '[]'::jsonb, -- Mitschnitt der Browseraktionen
    recipe_preview JSONB,                      -- destilliertes Recipe (vor Bestätigung)
    result_fields JSONB,                       -- vom Agenten benannte Ergebnisfelder
    screenshot_path TEXT,                      -- letzter Live-Screenshot
    error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_recorder_sessions_agent ON recorder_sessions(agent_id);

-- Down Migration

DROP TABLE recorder_sessions;
