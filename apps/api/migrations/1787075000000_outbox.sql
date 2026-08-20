-- Up Migration

CREATE TABLE outbox (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel TEXT NOT NULL,                       -- webhook | matrix
    payload JSONB NOT NULL,                       -- { agent, project, status, changed, data, link, ... }
    status TEXT NOT NULL DEFAULT 'pending',       -- pending | sent | failed
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    sent_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_outbox_dispatch ON outbox(status, next_attempt_at);

-- Down Migration

DROP TABLE outbox;
