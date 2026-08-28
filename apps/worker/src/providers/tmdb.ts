// Gemeinsamer TMDB-Lookup für Bewertungen (v3-API, keyless-Key aus TMDB_API_KEY).
// Genutzt von aniworld.ts (Serien-/Anime-Suche) und topstreamfilm.ts
// (Film-Suche). Kein Key gesetzt oder kein Treffer -> null statt Fehler, ein
// fehlender/falscher Titel-Match soll nie den ganzen Lauf kippen.

const ENDPOINT = 'https://api.themoviedb.org/3';

interface TmdbResult {
  rating: number;
  voteCount: number;
}

async function search(kind: 'movie' | 'tv', title: string, year?: string): Promise<TmdbResult | null> {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) return null;

  // Manche AniWorld-Titel hängen zur Reboot-Disambiguierung ein "(YYYY)" an
  // (z.B. "One Piece (2025)" für den 2023er Realserien-/Neuauflage-Fall) —
  // das killt die TMDB-Suche komplett (0 Treffer), darum vor der Anfrage weg.
  const query = title.replace(/\s*\(\d{4}\)$/, '');
  const params = new URLSearchParams({ api_key: apiKey, query, language: 'de-DE' });
  if (kind === 'movie' && year) params.set('year', year);

  const res = await fetch(`${ENDPOINT}/search/${kind}?${params.toString()}`);
  if (!res.ok) throw new Error(`TMDB HTTP ${res.status} bei Suche nach "${title}"`);
  const json: any = await res.json();

  // Erstes Ergebnis = TMDBs eigene Popularitäts-/Relevanz-Sortierung, für ein
  // exaktes bzw. sehr ähnliches Titel-Match zuverlässig genug — kein eigenes
  // Fuzzy-Matching nötig.
  const hit = json?.results?.[0];
  if (!hit || typeof hit.vote_average !== 'number' || hit.vote_count === 0) return null;
  return { rating: Math.round(hit.vote_average * 10) / 10, voteCount: hit.vote_count };
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
