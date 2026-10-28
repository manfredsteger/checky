-- Dauerhafter Titel-Index für Torrent-Quellen + Schnellsuche.
--
-- Bei LoveTorrent steht der volle Titel (Studio, Genre-Liste,
-- Format) nur auf der Detailseite. Bisher lag der Cache URL → voller Titel
-- nur im Worker-Speicher und war nach jedem Neustart weg. Hier bleibt er
-- erhalten: jeder Agenten-Lauf und jede Schnellsuche füllt ihn, Suchen darin
-- sind sofort da.
CREATE TABLE IF NOT EXISTS torrent_index (
  url        text PRIMARY KEY,
  source     text NOT NULL,
  list_title text,
  full_title text,
  size       text,
  posted     text,
  first_seen timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_torrent_index_source_seen ON torrent_index (source, first_seen DESC);

-- Schnellsuche: eine einmalige Suche ohne Agent und ohne Ergebnis-Historie.
-- Der Worker arbeitet sie ab und meldet unterwegs den Fortschritt.
CREATE TABLE IF NOT EXISTS quick_searches (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider    text NOT NULL,
  params      jsonb NOT NULL DEFAULT '{}',
  status      text NOT NULL DEFAULT 'queued',
  progress    jsonb,
  result      jsonb,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_quick_searches_created ON quick_searches (provider, created_at DESC);
