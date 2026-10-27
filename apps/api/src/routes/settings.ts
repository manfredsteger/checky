import { Router } from 'express';
import { UpdateSettingsSchema, MediaLibraryConfigSchema, testLibraryConnection } from '@checky/shared';
import { query } from '../db.js';
import { asyncHandler } from '../lib/http.js';
import { enqueue } from '../lib/boss.js';

export const settingsRouter = Router();

async function readSettings() {
  const { rows } = await query('SELECT key, value FROM settings');
  const map: Record<string, any> = {};
  for (const r of rows) map[r.key] = r.value;
  return {
    paused: map.paused === true,
    retention_days: typeof map.retention_days === 'number' ? map.retention_days : 30,
    notify: (map.notify && typeof map.notify === 'object') ? map.notify : {},
    sources: (map.sources && typeof map.sources === 'object') ? map.sources : {},
  };
}

settingsRouter.get('/api/settings', asyncHandler(async (_req, res) => {
  res.json(await readSettings());
}));

settingsRouter.put('/api/settings', asyncHandler(async (req, res) => {
  const data = UpdateSettingsSchema.parse(req.body);
  for (const [k, v] of Object.entries(data)) {
    await query(
      `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
      [k, JSON.stringify(v)]
    );
  }
  res.json(await readSettings());
}));

// Medienbibliothek: Verbindung mit den (noch ungespeicherten) Formularwerten
// prüfen — liefert Servername/Version und wie viele Serien/Filme eine TMDB-ID
// tragen (nur die lassen sich sicher zuordnen).
settingsRouter.post('/api/settings/media-library/test', asyncHandler(async (req, res) => {
  const cfg = MediaLibraryConfigSchema.parse(req.body);
  if (!cfg.url.trim() || !cfg.api_key.trim()) return res.status(400).json({ error: 'Adresse und API-Schlüssel sind nötig.' });
  try {
    res.json({ ok: true, ...(await testLibraryConnection(cfg)) });
  } catch (e) {
    res.status(502).json({ error: (e as Error).message });
  }
}));

settingsRouter.post('/api/admin/cleanup', asyncHandler(async (_req, res) => {
  const queued = await enqueue('cleanup', {});
  res.json({ ok: true, queued });
}));

// Prometheus-Metriken.
settingsRouter.get('/metrics', asyncHandler(async (_req, res) => {
  const byStatus = await query(`SELECT status, count(*)::int AS c FROM runs GROUP BY status`);
  const tokens = await query(`SELECT COALESCE(SUM(ai_tokens), 0)::int AS s FROM runs`);
  const queued = await query(`SELECT count(*)::int AS c FROM runs WHERE status = 'queued'`);

  let out = '';
  out += '# HELP checky_runs_total Anzahl Läufe nach Status\n# TYPE checky_runs_total counter\n';
  for (const r of byStatus.rows) out += `checky_runs_total{status="${r.status}"} ${r.c}\n`;
  out += '# HELP checky_ai_tokens_total Verbrauchte KI-Tokens gesamt\n# TYPE checky_ai_tokens_total counter\n';
  out += `checky_ai_tokens_total ${tokens.rows[0].s}\n`;
  out += '# HELP checky_queue_depth Anzahl wartender Läufe\n# TYPE checky_queue_depth gauge\n';
  out += `checky_queue_depth ${queued.rows[0].c}\n`;
  res.type('text/plain').send(out);
}));
