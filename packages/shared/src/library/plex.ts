// Plex-Client — nach der dokumentierten Plex Media Server API geschrieben,
// aber OHNE eigenen Plex-Server verifiziert (Stand 2026-09-16, kein Plex im
// Haus). In der Oberfläche darum als „experimentell" markiert.
//   GET /identity                                  Server-Id + Version
//   GET /library/sections                          Bibliotheken (type show|movie)
//   GET /library/sections/{key}/all?includeGuids=1 Einträge mit Guid[] (tmdb://123)
//   GET /library/metadata/{ratingKey}/allLeaves    alle Episoden einer Serie
// Auth per Header X-Plex-Token, JSON per Accept-Header.

import type { LibraryClient, LibraryIndex, LibrarySeries, MediaLibraryConfig, SeasonEpisodes } from './types.js';

const TIMEOUT_MS = 10_000;

function trimSlash(u: string): string { return u.replace(/\/+$/, ''); }

export class PlexClient implements LibraryClient {
  readonly kind = 'plex' as const;
  private readonly base: string;
  private readonly publicBase: string;
  private readonly token: string;
  private machineId: string | null = null;

  constructor(cfg: MediaLibraryConfig) {
    this.base = trimSlash(cfg.url);
    this.publicBase = trimSlash(cfg.public_url || cfg.url);
    this.token = cfg.api_key;
  }

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${this.base}${path}${qs ? `?${qs}` : ''}`, {
      headers: { 'accept': 'application/json', 'x-plex-token': this.token, 'x-plex-client-identifier': 'checky', 'x-plex-product': 'Checky' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401) throw new Error('plex: Token abgelehnt (HTTP 401)');
    if (!res.ok) throw new Error(`plex: HTTP ${res.status} bei ${path}`);
    return res.json() as Promise<T>;
  }

  async info(): Promise<{ name: string; version: string }> {
    const id = await this.get<any>('/identity');
    this.machineId = id?.MediaContainer?.machineIdentifier || null;
    let name = 'Plex';
    try { name = (await this.get<any>('/'))?.MediaContainer?.friendlyName || name; } catch { /* Name ist Kosmetik */ }
    return { name, version: id?.MediaContainer?.version || '?' };
  }

  async index(): Promise<LibraryIndex> {
    const sections = (await this.get<any>('/library/sections'))?.MediaContainer?.Directory || [];
    const series: LibrarySeries[] = [];
    const movies: LibrarySeries[] = [];
    for (const s of sections) {
      if (s.type !== 'show' && s.type !== 'movie') continue;
      const items = (await this.get<any>(`/library/sections/${s.key}/all`, { includeGuids: '1' }))?.MediaContainer?.Metadata || [];
      for (const it of items) {
        const entry: LibrarySeries = {
          id: String(it.ratingKey),
          name: String(it.title || ''),
          originalTitle: it.originalTitle ?? null,
          year: typeof it.year === 'number' ? it.year : null,
          tmdbId: parseTmdbGuid(it.Guid),
        };
        (s.type === 'show' ? series : movies).push(entry);
      }
    }
    return { series, movies };
  }

  async episodes(seriesId: string): Promise<SeasonEpisodes> {
    const leaves = (await this.get<any>(`/library/metadata/${encodeURIComponent(seriesId)}/allLeaves`))?.MediaContainer?.Metadata || [];
    const map: SeasonEpisodes = new Map();
    for (const e of leaves) {
      const season = e.parentIndex, ep = e.index;
      if (typeof season !== 'number' || typeof ep !== 'number') continue;
      if (!map.has(season)) map.set(season, new Set());
      map.get(season)!.add(ep);
    }
    return map;
  }

  itemUrl(id: string): string {
    const key = encodeURIComponent(`/library/metadata/${id}`);
    return this.machineId
      ? `${this.publicBase}/web/index.html#!/server/${this.machineId}/details?key=${key}`
      : `${this.publicBase}/web/index.html#!/details?key=${key}`;
  }
}

function parseTmdbGuid(guids: any): number | null {
  if (!Array.isArray(guids)) return null;
  for (const g of guids) {
    const m = String(g?.id || '').match(/^tmdb:\/\/(\d+)$/);
    if (m) return Number(m[1]);
  }
  return null;
}
