// Jellyfin- und Emby-Client (beide sprechen die MediaBrowser-API, Emby ist
// der Vorfahre von Jellyfin — gleiche Endpunkte, nur der Auth-Header heißt
// anders). Verifiziert gegen Jellyfin 10.11.6 (2026-09-16):
//   GET /System/Info                       Servername + Version (Verbindungstest)
//   GET /Items?includeItemTypes=Series…    alle Serien mit ProviderIds.Tmdb in EINEM Aufruf
//   GET /Items?includeItemTypes=Movie…     dito Filme
//   GET /Shows/{id}/Episodes?isMissing=false  alle Episoden aller Staffeln
// `isMissing=false` ist Pflicht: mit „fehlende Episoden anzeigen" legt
// Jellyfin virtuelle Platzhalter an, die sonst als vorhanden zählen würden.

import type { LibraryClient, LibraryIndex, LibrarySeries, MediaLibraryConfig, SeasonEpisodes } from './types.js';

const TIMEOUT_MS = 10_000;

function trimSlash(u: string): string { return u.replace(/\/+$/, ''); }

export class JellyfinClient implements LibraryClient {
  readonly kind: 'jellyfin' | 'emby';
  private readonly base: string;
  private readonly publicBase: string;
  private readonly key: string;
  private readonly user?: string;
  private userId: string | null | undefined; // undefined = noch nicht aufgelöst

  constructor(cfg: MediaLibraryConfig) {
    this.kind = cfg.kind === 'emby' ? 'emby' : 'jellyfin';
    this.base = trimSlash(cfg.url);
    this.publicBase = trimSlash(cfg.public_url || cfg.url);
    this.key = cfg.api_key;
    this.user = cfg.user?.trim() || undefined;
  }

  private headers(): Record<string, string> {
    // Jellyfin liest den Authorization-Header, Emby X-Emby-Token — beide
    // Header zu senden ist harmlos und erspart eine Fallunterscheidung.
    return {
      'accept': 'application/json',
      'authorization': `MediaBrowser Token="${this.key}", Client="Checky", Device="Checky", DeviceId="checky", Version="1"`,
      'x-emby-token': this.key,
    };
  }

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const qs = new URLSearchParams(params).toString();
    const url = `${this.base}${path}${qs ? `?${qs}` : ''}`;
    const res = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 401 || res.status === 403) throw new Error(`${this.kind}: API-Schlüssel abgelehnt (HTTP ${res.status})`);
    if (!res.ok) throw new Error(`${this.kind}: HTTP ${res.status} bei ${path}`);
    return res.json() as Promise<T>;
  }

  // Optionaler Benutzer: dann zählen nur Bibliotheken, die dieser Benutzer
  // sieht (Jellyfin filtert /Items per userId). Ohne Benutzer = Admin-Sicht.
  private async resolveUserId(): Promise<string | null> {
    if (this.userId !== undefined) return this.userId;
    if (!this.user) return (this.userId = null);
    const users = await this.get<{ Id: string; Name: string }[]>('/Users');
    const hit = users.find(u => u.Name.toLowerCase() === this.user!.toLowerCase());
    if (!hit) throw new Error(`${this.kind}: Benutzer „${this.user}" nicht gefunden`);
    return (this.userId = hit.Id);
  }

  async info(): Promise<{ name: string; version: string }> {
    const d = await this.get<{ ServerName?: string; Version?: string }>('/System/Info');
    return { name: d.ServerName || this.kind, version: d.Version || '?' };
  }

  private async listItems(type: 'Series' | 'Movie'): Promise<LibrarySeries[]> {
    const userId = await this.resolveUserId();
    const params: Record<string, string> = {
      includeItemTypes: type,
      recursive: 'true',
      fields: 'ProviderIds,OriginalTitle,Path',
      enableTotalRecordCount: 'false',
      enableImages: 'false',
    };
    if (userId) params.userId = userId;
    const d = await this.get<{ Items?: any[] }>('/Items', params);
    return (d.Items || []).map(it => ({
      id: String(it.Id),
      name: String(it.Name || ''),
      originalTitle: it.OriginalTitle ?? null,
      altTitles: folderTitle(it.Path, type),
      year: typeof it.ProductionYear === 'number' ? it.ProductionYear : null,
      tmdbId: parseTmdb(it.ProviderIds),
    }));
  }

  async index(): Promise<LibraryIndex> {
    const [series, movies] = await Promise.all([this.listItems('Series'), this.listItems('Movie')]);
    return { series, movies };
  }

  async episodes(seriesId: string): Promise<SeasonEpisodes> {
    const userId = await this.resolveUserId();
    const params: Record<string, string> = { isMissing: 'false', fields: 'LocationType', enableImages: 'false' };
    if (userId) params.userId = userId;
    const d = await this.get<{ Items?: any[] }>(`/Shows/${encodeURIComponent(seriesId)}/Episodes`, params);
    const map: SeasonEpisodes = new Map();
    for (const e of d.Items || []) {
      if (e.LocationType === 'Virtual') continue; // Platzhalter ohne Datei
      const season = e.ParentIndexNumber;
      const start = e.IndexNumber;
      if (typeof season !== 'number' || typeof start !== 'number') continue;
      const end = typeof e.IndexNumberEnd === 'number' && e.IndexNumberEnd >= start ? e.IndexNumberEnd : start;
      if (!map.has(season)) map.set(season, new Set());
      for (let n = start; n <= end; n++) map.get(season)!.add(n); // Doppelfolge E01-02 deckt beide ab
    }
    return map;
  }

  itemUrl(id: string): string {
    return this.kind === 'emby'
      ? `${this.publicBase}/web/index.html#!/item?id=${encodeURIComponent(id)}`
      : `${this.publicBase}/web/#/details?id=${encodeURIComponent(id)}`;
  }
}

// Der Ordnername trägt oft einen weiteren Namen als die Metadaten: Namy legt
// „That Time I Got Reincarnated as a Slime [tmdbid-82684]" ab, Jellyfin nennt
// die Serie danach aber „Meine Wiedergeburt als Schleim in einer anderen Welt".
// Der bereinigte Ordnername (ohne [tmdbid-…]/{tmdb-…}-Tags, Jahr und Endung)
// wird darum als Zusatz-Titel für den Fallback mitgeführt. Bei Serien zeigt
// `Path` auf den Serienordner, bei Filmen auf die Datei — dann zählt auch der
// Elternordner, aber nur, wenn er wie ein Filmordner aussieht (Jahr oder
// ID-Tag), nicht die Bibliothekswurzel „filme".
const ID_TAG = /\s*[\[{]\s*(tmdb|imdb|tvdb)(id)?[-=]\s*[^\]}]*[\]}]/gi;
const YEAR_SUFFIX = /\s*\(\d{4}\)\s*$/;
const MEDIA_EXT = /\.(mkv|mp4|m4v|avi|mov|wmv|ts|webm|iso|strm)$/i;

export function folderTitle(path: unknown, kind: 'Series' | 'Movie' = 'Series'): string[] {
  if (typeof path !== 'string' || !path) return [];
  const parts = path.split(/[\\/]+/).filter(Boolean);
  const clean = (raw: string) => raw.replace(MEDIA_EXT, '').replace(ID_TAG, '').replace(YEAR_SUFFIX, '').trim();
  const out: string[] = [];
  const last = parts.pop();
  if (last) { const n = clean(last); if (n) out.push(n); }
  if (kind === 'Movie') {
    const parent = parts.pop();
    if (parent && (YEAR_SUFFIX.test(parent) || new RegExp(ID_TAG.source, 'i').test(parent))) {
      const n = clean(parent);
      if (n && !out.includes(n)) out.push(n);
    }
  }
  return out;
}

function parseTmdb(providerIds: any): number | null {
  if (!providerIds || typeof providerIds !== 'object') return null;
  // Schlüssel-Schreibweise variiert (Tmdb / tmdb / TMDB).
  const key = Object.keys(providerIds).find(k => k.toLowerCase() === 'tmdb');
  const n = key ? Number(providerIds[key]) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}
