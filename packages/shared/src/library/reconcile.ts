// Abgleich-Logik ohne I/O: Einträge eines Neuigkeiten-Ergebnisses gegen den
// Bibliotheks-Index stellen. Reine Funktionen, damit sie ohne Server testbar
// sind. Der I/O-Teil (Index laden, Episoden je Serie holen) wird injiziert.

import type { ItemRef, LibraryIndex, LibraryInfo, LibrarySeries, ReconcileSummary, SeasonEpisodes } from './types.js';

const MISSING_LIST_CAP = 50;

// AniWorld: /anime/stream/<slug>/staffel-2/episode-11 bzw. /filme/film-3.
export function parseAniworldRef(url: string): ItemRef | null {
  const ep = url.match(/\/staffel-(\d+)\/episode-(\d+)\/?$/);
  if (ep) return { kind: 'episode', season: Number(ep[1]), episode: Number(ep[2]) };
  const film = url.match(/\/filme\/film-(\d+)\/?$/);
  if (film) return { kind: 'film', number: Number(film[1]) };
  return null;
}

// Titel-Normalform für den Fallback ohne TMDB-ID: Kleinschreibung, Jahr in
// Klammern weg, Akzente weg, nur Buchstaben/Ziffern (aller Schriften — auch
// japanische Originaltitel sollen vergleichbar bleiben), ein Leerzeichen dazwischen.
export function normalizeTitle(s: string): string {
  return s
    .replace(/\s*\(\d{4}\)\s*$/, '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export interface Matchers {
  seriesByTmdb: Map<number, LibrarySeries>;
  seriesByTitle: Map<string, LibrarySeries[]>;
  moviesByTmdb: Map<number, LibrarySeries>;
  moviesByTitle: Map<string, LibrarySeries[]>;
}

export function buildMatchers(index: LibraryIndex): Matchers {
  const byTmdb = (list: LibrarySeries[]) => {
    const m = new Map<number, LibrarySeries>();
    for (const s of list) if (s.tmdbId != null && !m.has(s.tmdbId)) m.set(s.tmdbId, s);
    return m;
  };
  const byTitle = (list: LibrarySeries[]) => {
    const m = new Map<string, LibrarySeries[]>();
    for (const s of list) {
      for (const t of new Set([s.name, s.originalTitle || '', ...(s.altTitles || [])].map(normalizeTitle))) {
        if (!t) continue;
        if (!m.has(t)) m.set(t, []);
        m.get(t)!.push(s);
      }
    }
    return m;
  };
  return {
    seriesByTmdb: byTmdb(index.series), seriesByTitle: byTitle(index.series),
    moviesByTmdb: byTmdb(index.movies), moviesByTitle: byTitle(index.movies),
  };
}

export interface Match { item: LibrarySeries; match: 'tmdb' | 'title'; }

// TMDB-ID zuerst (eindeutig), sonst Titel-Normalform — der Quell-Titel und
// alle weiteren bekannten Namen (TMDB: deutsch/englisch/Original), denn die
// Quelle nennt eine Serie oft englisch, die Bibliothek deutsch. Bei mehreren
// Titel-Treffern (z.B. „One Piece" doppelt) der mit passendem Jahr, sonst der erste.
export function matchEntry(
  byTmdb: Map<number, LibrarySeries>, byTitle: Map<string, LibrarySeries[]>,
  tmdbId: number | null | undefined, title: string, year?: number | null, altTitles: string[] = [],
): Match | null {
  if (tmdbId != null && byTmdb.has(tmdbId)) return { item: byTmdb.get(tmdbId)!, match: 'tmdb' };
  const candidates: LibrarySeries[] = [];
  for (const t of new Set([title, ...altTitles].map(normalizeTitle))) {
    for (const c of byTitle.get(t) || []) if (!candidates.includes(c)) candidates.push(c);
  }
  if (!candidates.length) return null;
  const byYear = year != null ? candidates.find(c => c.year === year) : undefined;
  return { item: byYear || candidates[0], match: 'title' };
}

// Fehlende Nummern von 1 bis zur neuesten in der Quelle gelisteten Episode.
// Bewusst NICHT nur „neueste − höchste vorhandene": eine Lücke mittendrin
// (E08 fehlt, E09–E13 da) soll genauso auffallen.
export function diffSeason(newest: number, have: Set<number> | undefined): { have_until: number | null; missing: number[] } {
  const set = have || new Set<number>();
  const have_until = set.size ? Math.max(...set) : null;
  const missing: number[] = [];
  for (let n = 1; n <= newest; n++) if (!set.has(n)) missing.push(n);
  return { have_until, missing };
}

// Erwartete Item-Form (von den Providern geliefert). Alles optional — Items
// ohne `ref` werden nicht angefasst.
export interface ReconcilableItem {
  title?: string;
  url?: string;
  ref?: ItemRef | null;
  tmdb_id?: number | null;
  tmdb_titles?: string[] | null; // weitere Namen laut TMDB (de/en/Original) für den Titel-Fallback
  series_title?: string | null;  // Serientitel ohne Episoden-Suffix
  series_url?: string | null;    // Dedup-Schlüssel je Serie
  year?: number | null;
  library?: LibraryInfo;
  [k: string]: any;
}

function unknown(note: string): LibraryInfo {
  return { status: 'unknown', match: null, have_until: null, missing: [], missing_count: 0, url: null, note };
}

export async function reconcileItems(
  items: ReconcilableItem[],
  index: LibraryIndex,
  getEpisodes: (seriesId: string) => Promise<SeasonEpisodes>,
  urlOf: (id: string) => string,
): Promise<ReconcileSummary> {
  const m = buildMatchers(index);
  const summary: ReconcileSummary = { checked: 0, missing_total: 0, series_matched: 0 };

  // --- Serien: nach Serie gruppieren, je Serie einmal Episoden laden ---------
  const groups = new Map<string, ReconcilableItem[]>();
  for (const it of items) {
    if (it.ref?.kind !== 'episode') continue;
    const key = it.series_url || it.series_title || it.title || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(it);
  }

  for (const group of groups.values()) {
    const first = group[0];
    const title = first.series_title || first.title || '';
    const match = matchEntry(m.seriesByTmdb, m.seriesByTitle, first.tmdb_id, title, first.year, first.tmdb_titles || []);
    summary.checked += group.length;
    if (!match) {
      for (const it of group) it.library = { status: 'series_missing', match: null, have_until: null, missing: [], missing_count: 0, url: null };
      continue;
    }
    summary.series_matched++;
    let seasons: SeasonEpisodes;
    try {
      seasons = await getEpisodes(match.item.id);
    } catch (e) {
      for (const it of group) it.library = unknown(`Episodenliste nicht ladbar: ${(e as Error).message}`);
      continue;
    }
    // Neueste gelistete Episode je Staffel (über alle Zeilen dieser Serie).
    const newestBySeason = new Map<number, number>();
    for (const it of group) {
      const r = it.ref as Extract<ItemRef, { kind: 'episode' }>;
      newestBySeason.set(r.season, Math.max(newestBySeason.get(r.season) || 0, r.episode));
    }
    const link = urlOf(match.item.id);
    const countedSeasons = new Set<number>();
    for (const it of group) {
      const r = it.ref as Extract<ItemRef, { kind: 'episode' }>;
      const have = seasons.get(r.season);
      const { have_until, missing } = diffSeason(newestBySeason.get(r.season)!, have);
      const status = !have ? 'season_missing' : have.has(r.episode) ? 'present' : 'missing';
      it.library = {
        status, match: match.match, have_until,
        missing: missing.slice(0, MISSING_LIST_CAP), missing_count: missing.length, url: link,
      };
      if (!countedSeasons.has(r.season)) { countedSeasons.add(r.season); summary.missing_total += missing.length; }
    }
  }

  // --- Filme -----------------------------------------------------------------
  for (const it of items) {
    if (it.ref?.kind === 'film') { it.library = unknown('AniWorld-Filmnummer lässt sich keinem Bibliothekseintrag zuordnen'); continue; }
    if (it.ref?.kind !== 'movie') continue;
    summary.checked++;
    const match = matchEntry(m.moviesByTmdb, m.moviesByTitle, it.tmdb_id, it.series_title || it.title || '', it.year, it.tmdb_titles || []);
    if (!match) {
      it.library = { status: 'series_missing', match: null, have_until: null, missing: [], missing_count: 1, url: null };
      summary.missing_total++;
    } else {
      it.library = { status: 'present', match: match.match, have_until: null, missing: [], missing_count: 0, url: urlOf(match.item.id) };
    }
  }

  return summary;
}
