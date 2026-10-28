// Schnellsuche + dauerhafter Titel-Index.
//
// Schnellsuche = eine einmalige Provider-Abfrage mit Suchbegriff, ohne Agent,
// ohne Ergebnis-Historie und ohne Tageslimit (es ist kein Lauf). Die API legt
// eine Zeile in quick_searches an und reiht einen Job ein; hier wird er
// abgearbeitet, der Fortschritt landet laufend in der Zeile, die Oberfläche
// fragt ihn ab.
import type { Pool } from 'pg';
import { getSettings } from './notify.js';
import { fetchProvider, type TitleStore, type ProviderProgress } from './providers/index.js';
import { matchesSearch } from './providers/lovetorrent.js';

// Tabelle torrent_index als Titel-Speicher einer Quelle.
export function createTitleStore(pool: Pool, source: string): TitleStore {
  return {
    async load(urls) {
      const map = new Map<string, string>();
      if (!urls.length) return map;
      const { rows } = await pool.query(
        `SELECT url, full_title FROM torrent_index WHERE url = ANY($1) AND full_title IS NOT NULL`, [urls]);
      for (const r of rows) map.set(r.url, r.full_title);
      return map;
    },
    async save(entries) {
      for (const e of entries) {
        await pool.query(
          `INSERT INTO torrent_index (url, source, list_title, full_title, size, posted)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (url) DO UPDATE SET full_title = EXCLUDED.full_title,
             list_title = EXCLUDED.list_title, size = EXCLUDED.size`,
          [e.url, source, e.listTitle, e.fullTitle, e.size, e.posted]);
      }
    },
  };
}

// Ältere Treffer aus dem Index: Einträge, die schon früher einmal geprüft
// wurden, aber nicht mehr unter den neuesten N liegen. Kostet keinen
// einzigen Seitenabruf.
async function olderIndexMatches(pool: Pool, source: string, search: string, exclude: string[], max = 100) {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const conds = words.map((_, i) => `(coalesce(full_title,'') || ' ' || coalesce(list_title,'')) ILIKE $${i + 3}`);
  const { rows } = await pool.query(
    `SELECT url, full_title, list_title, size, posted FROM torrent_index
     WHERE source = $1 AND NOT (url = ANY($2)) AND ${conds.join(' AND ')}
     ORDER BY first_seen DESC LIMIT ${max}`,
    [source, exclude, ...words.map(w => `%${w.replace(/[%_\\]/g, '\\$&')}%`)]);
  return rows
    .filter(r => matchesSearch(`${r.list_title ?? ''} ${r.full_title ?? ''}`, search))
    .map(r => ({ title: r.full_title || r.list_title, url: r.url, size: r.size, date: r.posted }));
}

export async function handleQuickSearch(pool: Pool, id: string) {
  const { rows } = await pool.query('SELECT * FROM quick_searches WHERE id = $1', [id]);
  const qs = rows[0];
  if (!qs || qs.status !== 'queued') return;
  await pool.query(`UPDATE quick_searches SET status = 'running' WHERE id = $1`, [id]);

  // Fortschritt höchstens 1×/s schreiben, sonst bei 300 Abrufen 300 Updates.
  let last = 0, pending: ProviderProgress | null = null;
  const flush = async () => {
    if (!pending) return;
    const p = pending; pending = null; last = Date.now();
    await pool.query('UPDATE quick_searches SET progress = $1 WHERE id = $2', [JSON.stringify(p), id]).catch(() => {});
  };
  const onProgress = (p: ProviderProgress) => {
    pending = p;
    if (Date.now() - last >= 1000) void flush();
  };

  try {
    const { sources } = await getSettings(pool);
    const params = qs.params || {};
    const result = await fetchProvider(qs.provider, params, {
      sources, titleStore: createTitleStore(pool, qs.provider), onProgress,
    });
    const items: any[] = Array.isArray(result.items) ? result.items : [];
    const older = params.suche
      ? await olderIndexMatches(pool, qs.provider, String(params.suche), items.map(i => i.url))
      : [];
    await pool.query(
      `UPDATE quick_searches SET status = 'succeeded', finished_at = NOW(), progress = NULL, result = $1 WHERE id = $2`,
      [JSON.stringify({ ...result, older_items: older }), id]);
    console.log(`[Worker] Schnellsuche ${id} („${params.suche}") fertig: ${items.length} Treffer + ${older.length} ältere`);
  } catch (e: any) {
    await pool.query(
      `UPDATE quick_searches SET status = 'failed', finished_at = NOW(), error = $1 WHERE id = $2`,
      [String(e?.message || e), id]);
    console.warn(`[Worker] Schnellsuche ${id} fehlgeschlagen:`, e?.message || e);
  }
}
