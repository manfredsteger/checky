// Einstieg für den Bibliotheks-Abgleich: Client je System, Anreicherung eines
// Provider-Ergebnisses, Verbindungstest — und die Sicht aufs Ergebnis, die in
// den Änderungs-Hash geht (ohne Bibliotheksfelder).

import { JellyfinClient } from './jellyfin.js';
import { PlexClient } from './plex.js';
import { reconcileItems, type ReconcilableItem } from './reconcile.js';
import type { LibraryClient, LibraryIndex, MediaLibraryConfig } from './types.js';

export * from './types.js';
export * from './reconcile.js';
export { JellyfinClient, folderTitle } from './jellyfin.js';
export { PlexClient } from './plex.js';

export const LIBRARY_KINDS: { id: MediaLibraryConfig['kind']; label: string; experimental?: boolean }[] = [
  { id: 'jellyfin', label: 'Jellyfin' },
  { id: 'emby', label: 'Emby' },
  { id: 'plex', label: 'Plex', experimental: true },
];

export function isLibraryConfigured(cfg: Partial<MediaLibraryConfig> | null | undefined): cfg is MediaLibraryConfig {
  return !!cfg && !!cfg.kind && !!cfg.url?.trim() && !!cfg.api_key?.trim();
}

export function createLibraryClient(cfg: MediaLibraryConfig): LibraryClient {
  if (cfg.kind === 'plex') return new PlexClient(cfg);
  return new JellyfinClient(cfg);
}

export interface ConnectionTest { name: string; version: string; series: number; movies: number; series_with_tmdb: number; movies_with_tmdb: number; }

export async function testLibraryConnection(cfg: MediaLibraryConfig): Promise<ConnectionTest> {
  const client = createLibraryClient(cfg);
  const info = await client.info();
  const idx = await client.index();
  return {
    ...info,
    series: idx.series.length, movies: idx.movies.length,
    series_with_tmdb: idx.series.filter(s => s.tmdbId != null).length,
    movies_with_tmdb: idx.movies.filter(s => s.tmdbId != null).length,
  };
}

// Index-Cache: mehrere Agenten laufen kurz nacheinander (09:00-Cron), die
// Serien-/Filmliste ändert sich nicht in dieser Zeit.
const INDEX_TTL_MS = 5 * 60 * 1000;
const indexCache = new Map<string, { at: number; index: Promise<LibraryIndex> }>();

function cachedIndex(client: LibraryClient, cacheKey: string): Promise<LibraryIndex> {
  const hit = indexCache.get(cacheKey);
  if (hit && Date.now() - hit.at < INDEX_TTL_MS) return hit.index;
  const index = client.index();
  indexCache.set(cacheKey, { at: Date.now(), index });
  index.catch(() => indexCache.delete(cacheKey)); // Fehler nicht 5 Minuten lang festhalten
  return index;
}

export function clearLibraryCache(): void { indexCache.clear(); }

// Reichert ein Provider-Ergebnis (mit `items[]`) in-place um `library`-Felder
// an. Wirft NIE — ein Bibliotheksfehler darf den Lauf nicht kippen; er landet
// als `library_error` im Ergebnis und die Oberfläche zeigt einen Hinweis.
export async function enrichWithLibrary(result: Record<string, any>, cfg: MediaLibraryConfig): Promise<void> {
  const items: ReconcilableItem[] = Array.isArray(result.items) ? result.items : [];
  if (!items.some(it => it && typeof it === 'object' && it.ref)) return; // kein abgleichbarer Inhalt
  result.library_kind = cfg.kind;
  try {
    const client = createLibraryClient(cfg);
    const index = await cachedIndex(client, `${cfg.kind}|${cfg.url}|${cfg.user || ''}`);
    const summary = await reconcileItems(items, index, id => client.episodes(id), id => client.itemUrl(id));
    result.library_checked = summary.checked;
    result.library_missing_total = summary.missing_total;
    result.library_error = null;
  } catch (e) {
    result.library_checked = 0;
    result.library_missing_total = null;
    result.library_error = (e as Error).message;
    for (const it of items) if (it && typeof it === 'object') delete it.library;
  }
}

// Sicht fürs Hashing: Bibliotheksfelder raus. „Geändert" soll heißen „die
// Quelle hat etwas Neues", nicht „ich habe gestern Folgen nachgeladen".
export function hashableView<T>(data: T): T {
  if (Array.isArray(data)) return data.map(hashableView) as T;
  if (data && typeof data === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(data as Record<string, any>)) {
      if (k === 'library' || k.startsWith('library_')) continue;
      out[k] = hashableView(v);
    }
    return out as T;
  }
  return data;
}

// Kanonisches JSON: Schlüssel auf JEDER Ebene sortiert. (Ein Replacer-Array in
// JSON.stringify sortiert nur die oberste Ebene — und lässt verschachtelte
// Schlüssel weg, die dort nicht vorkommen.)
export function canonicalJson(data: unknown): string {
  return JSON.stringify(sortKeys(data));
}

function sortKeys(v: any): any {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out: Record<string, any> = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}
