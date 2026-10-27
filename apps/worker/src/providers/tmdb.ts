// Gemeinsamer TMDB-Lookup für Bewertungen (v3-API, keyless-Key aus TMDB_API_KEY).
// Genutzt von aniworld.ts (Serien-/Anime-Suche) und topstreamfilm.ts
// (Film-Suche). Kein Key gesetzt oder kein Treffer -> null statt Fehler, ein
// fehlender/falscher Titel-Match soll nie den ganzen Lauf kippen.

import { normalizeTitle } from '@checky/shared';

const ENDPOINT = 'https://api.themoviedb.org/3';

export interface TmdbResult {
  id: number;          // TMDB-ID — Schlüssel für den Bibliotheks-Abgleich (Jellyfin liest sie aus „[tmdbid-X]")
  rating: number | null;
  voteCount: number;
  titles: string[];    // alle bei der Suche gesehenen Namen dieser ID (deutsch, englisch, Original) — für den Titel-Fallback im Abgleich
}

// Rohes Suchergebnis (Serie: name/original_name, Film: title/original_title).
export interface TmdbHit {
  id: number;
  name?: string; original_name?: string;
  title?: string; original_title?: string;
  vote_average?: number; vote_count?: number;
}

function namesOf(hit: TmdbHit): string[] {
  return [hit.name, hit.original_name, hit.title, hit.original_title].filter((s): s is string => !!s);
}

// Der Treffer, dessen Name (in der abgefragten Sprache oder im Original)
// dem Suchbegriff nach Normalform genau entspricht — sonst undefined.
// Reine Funktion, damit sie ohne Netz testbar ist.
export function pickExactHit(results: TmdbHit[], query: string): TmdbHit | undefined {
  const want = normalizeTitle(query);
  if (!want) return undefined;
  return results.find(h => typeof h.id === 'number' && namesOf(h).some(n => normalizeTitle(n) === want));
}

async function fetchResults(kind: 'movie' | 'tv', query: string, language: string, year?: string): Promise<TmdbHit[]> {
  const apiKey = process.env.TMDB_API_KEY!;
  const params = new URLSearchParams({ api_key: apiKey, query, language });
  if (kind === 'movie' && year) params.set('year', year);
  const res = await fetch(`${ENDPOINT}/search/${kind}?${params.toString()}`);
  if (!res.ok) throw new Error(`TMDB HTTP ${res.status} bei Suche nach "${query}"`);
  const json: any = await res.json();
  return Array.isArray(json?.results) ? json.results : [];
}

async function search(kind: 'movie' | 'tv', title: string, year?: string): Promise<TmdbResult | null> {
  if (!process.env.TMDB_API_KEY) return null;

  // Manche AniWorld-Titel hängen zur Reboot-Disambiguierung ein "(YYYY)" an
  // (z.B. "One Piece (2025)" für den 2023er Realserien-/Neuauflage-Fall) —
  // das killt die TMDB-Suche komplett (0 Treffer), darum vor der Anfrage weg.
  const query = title.replace(/\s*\(\d{4}\)$/, '');

  // TMDB sortiert nach Popularität, und die Suche matcht auch Alternativtitel —
  // das erste Ergebnis ist deshalb nicht immer die gemeinte Serie: für
  // „That Time I Got Reincarnated as a Slime" kam das Spin-off „Die
  // Schleim-Tagebücher" vor der Hauptserie. Darum: erst der Treffer, dessen
  // deutscher/Original-Name exakt passt; sonst dieselbe Suche auf Englisch
  // (AniWorld nennt Serien englisch, Jellyfin führt sie oft deutsch); erst
  // wenn auch das nichts ergibt, die Popularitäts-Nr. 1.
  const de = await fetchResults(kind, query, 'de-DE', year);
  if (!de.length) return null;
  let en: TmdbHit[] = [];
  let hit = pickExactHit(de, query);
  if (!hit) {
    en = await fetchResults(kind, query, 'en-US', year);
    hit = pickExactHit(en, query);
  }
  hit ??= de[0];
  if (typeof hit.id !== 'number') return null;

  const titles = [...new Set([...de, ...en].filter(h => h.id === hit!.id).flatMap(namesOf))];
  // Ohne Stimmen gibt es keine Bewertung — die ID bleibt trotzdem nützlich.
  const rated = typeof hit.vote_average === 'number' && (hit.vote_count ?? 0) > 0;
  return {
    id: hit.id,
    rating: rated ? Math.round(hit.vote_average! * 10) / 10 : null,
    voteCount: hit.vote_count ?? 0,
    titles,
  };
}

export async function searchMovieRating(title: string, year?: string): Promise<TmdbResult | null> {
  try {
    return await search('movie', title, year);
  } catch {
    return null;
  }
}

export async function searchTvRating(title: string): Promise<TmdbResult | null> {
  try {
    return await search('tv', title);
  } catch {
    return null;
  }
}
