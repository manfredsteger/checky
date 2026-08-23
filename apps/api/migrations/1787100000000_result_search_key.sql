-- Messreihen trennen: zu welcher Suche gehört ein Ergebnis?
--
-- Ändert man die Suchparameter (z.B. das Reiseziel), messen die Agenten ab
-- da etwas anderes. Alte und neue Werte in einem Diagramm zu mischen, wäre
-- irreführend. Deshalb bekommt jedes Ergebnis den Fingerabdruck der Suche, mit
-- der es entstanden ist — plus die Parameter selbst, damit man später noch
-- nachvollziehen kann, WAS anders war.
ALTER TABLE results ADD COLUMN IF NOT EXISTS search_key text;
ALTER TABLE results ADD COLUMN IF NOT EXISTS search_params jsonb;

CREATE INDEX IF NOT EXISTS idx_results_agent_searchkey ON results (agent_id, search_key, created_at DESC);
