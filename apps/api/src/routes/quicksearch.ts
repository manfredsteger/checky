import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { asyncHandler, IdParamSchema } from '../lib/http.js';
import { enqueue } from '../lib/boss.js';

// Schnellsuche: einmalige Suche über eine Torrent-Quelle, ohne Agent und
// ohne Ergebnis-Historie. Der Worker arbeitet sie ab (Queue „quick-search"),
// die Oberfläche fragt GET /api/quick-search/:id ab, bis sie fertig ist.
export const quickSearchRouter = Router();

// Nur Provider, die einen Titel-Filter „suche" können.
const QUICK_SEARCH_PROVIDERS = ['lovetorrent'] as const;

const CreateQuickSearchSchema = z.object({
  provider: z.enum(QUICK_SEARCH_PROVIDERS),
  suche: z.string().trim().min(2).max(200),
  limit: z.coerce.number().int().min(30).max(1500).default(300),
});

quickSearchRouter.post('/api/quick-search', asyncHandler(async (req, res) => {
  const data = CreateQuickSearchSchema.parse(req.body);
  // Alte Suchen wegräumen — sie sind nur Zwischenstand, keine Historie.
  await query(`DELETE FROM quick_searches WHERE created_at < NOW() - INTERVAL '7 days'`);
  const { rows } = await query(
    `INSERT INTO quick_searches (provider, params) VALUES ($1, $2) RETURNING *`,
    [data.provider, { suche: data.suche, limit: data.limit }]);
  await enqueue('quick-search', { id: rows[0].id });
  res.status(201).json(rows[0]);
}));

quickSearchRouter.get('/api/quick-search/:id', asyncHandler(async (req, res) => {
  const { id } = IdParamSchema.parse(req.params);
  const { rows } = await query('SELECT * FROM quick_searches WHERE id = $1', [id]);
  if (!rows.length) return res.status(404).json({ error: 'Schnellsuche nicht gefunden' });
  res.json(rows[0]);
}));

// Zuletzt gesuchte Begriffe (Ein-Klick-Wiederholung) + die jüngste Suche,
// damit die Kachel sie auch auf einem anderen Gerät gleich anzeigt.
quickSearchRouter.get('/api/quick-search', asyncHandler(async (req, res) => {
  const provider = String(req.query.provider || 'lovetorrent');
  const { rows } = await query(
    `SELECT params->>'suche' AS suche, MAX(created_at) AS last
     FROM quick_searches WHERE provider = $1 AND status = 'succeeded'
     GROUP BY 1 ORDER BY last DESC LIMIT 8`, [provider]);
  const latest = await query(
    `SELECT id FROM quick_searches WHERE provider = $1 ORDER BY created_at DESC LIMIT 1`, [provider]);
  res.json({ recent: rows.map(r => r.suche), latest_id: latest.rows[0]?.id ?? null });
}));
