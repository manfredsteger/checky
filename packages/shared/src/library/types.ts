// Medienbibliothek-Abgleich: gemeinsame Typen für alle Bibliotheks-Systeme
// (Jellyfin, Emby, Plex). Ein Neuigkeiten-Eintrag (neue Episode / neuer Film)
// wird gegen die eigene Bibliothek geprüft — „schon da?" bzw. „+N fehlen".

export type LibraryKind = 'jellyfin' | 'emby' | 'plex';

export interface MediaLibraryConfig {
  kind: LibraryKind;
  url: string;          // Adresse, die Worker/API erreichen (im LAN meist http://IP:Port)
  api_key: string;      // Jellyfin/Emby: API-Schlüssel, Plex: X-Plex-Token
  public_url?: string;  // Optional: Adresse für Links im Browser (z.B. https://jellyfin.example)
  user?: string;        // Optional: Benutzername — Jellyfin/Emby zeigen dann nur dessen Bibliotheken
}

export interface LibrarySeries {
  id: string;
  name: string;
  originalTitle?: string | null;
  altTitles?: string[];      // weitere bekannte Namen (z.B. aus dem Ordnernamen), nur für den Titel-Fallback
  year?: number | null;
  tmdbId: number | null;
}

export type LibraryMovie = LibrarySeries;

export interface LibraryIndex {
  series: LibrarySeries[];
  movies: LibraryMovie[];
}

// Staffelnummer -> vorhandene Episodennummern (nur echte Dateien, keine
// virtuellen Platzhalter).
export type SeasonEpisodes = Map<number, Set<number>>;

export interface LibraryClient {
  readonly kind: LibraryKind;
  info(): Promise<{ name: string; version: string }>;
  index(): Promise<LibraryIndex>;
  episodes(seriesId: string): Promise<SeasonEpisodes>;
  itemUrl(id: string): string;
}

// Woher ein Eintrag stammt — aus der Quell-URL geparst.
export type ItemRef =
  | { kind: 'episode'; season: number; episode: number }
  | { kind: 'film'; number: number }   // AniWorld-„Film N" (nicht auf TMDB abbildbar)
  | { kind: 'movie' };                 // eigenständiger Film (TopStreamFilm)

export type LibraryStatus =
  | 'present'         // genau dieser Eintrag ist in der Bibliothek
  | 'missing'         // Serie/Staffel da, diese Episode (bzw. dieser Film) fehlt
  | 'season_missing'  // Serie da, die Staffel fehlt komplett
  | 'series_missing'  // Serie/Film gar nicht in der Bibliothek
  | 'unknown';        // kein Abgleich möglich (Fehler, kein Bezug, Film N)

export interface LibraryInfo {
  status: LibraryStatus;
  match: 'tmdb' | 'title' | null;   // wie die Serie/der Film zugeordnet wurde
  have_until: number | null;        // höchste vorhandene Episodennummer der Staffel
  missing: number[];                // fehlende Episodennummern 1..neueste (gedeckelt)
  missing_count: number;
  url: string | null;               // Deep-Link in die Bibliothek
  note?: string;                    // Klartext-Begründung bei unknown
}

export interface ReconcileSummary {
  checked: number;        // Einträge mit Bezug (episode/movie), die geprüft wurden
  missing_total: number;  // Summe fehlender Episoden/Filme über alle Serien/Staffeln
  series_matched: number;
}
