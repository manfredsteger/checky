import { describe, it, expect } from 'vitest';
import {
  parseAniworldRef, normalizeTitle, diffSeason, buildMatchers, matchEntry, reconcileItems,
  hashableView, canonicalJson, folderTitle, type LibraryIndex, type SeasonEpisodes,
} from '@checky/shared';

const INDEX: LibraryIndex = {
  series: [
    { id: 'jf-clev', name: 'Clevatess', originalTitle: 'クレバテス', year: 2025, tmdbId: 258348 },
    { id: 'jf-op-1', name: 'One Piece', originalTitle: 'ONE PIECE', year: 1999, tmdbId: 37854 },
    { id: 'jf-op-2', name: 'ONE PIECE', originalTitle: 'ONE PIECE', year: 2023, tmdbId: 111110 },
    { id: 'jf-notag', name: 'Skeleton Knight in Another World', originalTitle: null, year: 2022, tmdbId: null },
    // Deutsch benannt, Ordner englisch (Namy), TMDB-ID im Ordner — aber die Quelle liefert eine andere ID (Spin-off)
    { id: 'jf-slime', name: 'Meine Wiedergeburt als Schleim in einer anderen Welt', originalTitle: '転生したらスライムだった件', altTitles: ['That Time I Got Reincarnated as a Slime'], year: 2018, tmdbId: 82684 },
  ],
  movies: [
    { id: 'jf-dp', name: 'Deadpool & Wolverine', originalTitle: 'Deadpool & Wolverine', year: 2024, tmdbId: 533535 },
  ],
};

const EPISODES: Record<string, SeasonEpisodes> = {
  'jf-clev': new Map([[1, new Set([1, 2, 3])], [2, new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])]]),
  'jf-notag': new Map([[2, new Set([1, 2, 3, 5, 6, 7, 8])]]),
  'jf-op-1': new Map([[22, new Set([1, 2])]]),
};
const getEpisodes = async (id: string) => {
  if (!EPISODES[id]) throw new Error('boom');
  return EPISODES[id];
};
const urlOf = (id: string) => `https://jellyfin.example/web/#/details?id=${id}`;

describe('parseAniworldRef', () => {
  it('erkennt Staffel/Episode und Film aus der URL', () => {
    expect(parseAniworldRef('https://aniworld.to/anime/stream/clevatess/staffel-2/episode-11')).toEqual({ kind: 'episode', season: 2, episode: 11 });
    expect(parseAniworldRef('https://aniworld.to/anime/stream/one-piece/filme/film-3')).toEqual({ kind: 'film', number: 3 });
    expect(parseAniworldRef('https://aniworld.to/anime/stream/clevatess')).toBeNull();
  });
});

describe('normalizeTitle', () => {
  it('macht Jahr, Akzente, Satzzeichen und Groß/Klein unerheblich', () => {
    expect(normalizeTitle('One Piece (2025)')).toBe('one piece');
    expect(normalizeTitle('KonoSuba: God’s blessing on this wonderful world!')).toBe('konosuba god s blessing on this wonderful world');
    expect(normalizeTitle('Es war einmal… der Mensch')).toBe('es war einmal der mensch');
  });
});

describe('diffSeason', () => {
  it('zählt Lücken bis zur neuesten Episode, nicht nur die Differenz', () => {
    expect(diffSeason(19, new Set([1, 2, 3, 16]))).toEqual({ have_until: 16, missing: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 19] });
    expect(diffSeason(19, new Set(Array.from({ length: 16 }, (_, i) => i + 1)))).toEqual({ have_until: 16, missing: [17, 18, 19] });
    expect(diffSeason(3, new Set([1, 2, 3]))).toEqual({ have_until: 3, missing: [] });
    expect(diffSeason(2, undefined)).toEqual({ have_until: null, missing: [1, 2] });
  });
});

describe('matchEntry', () => {
  const m = buildMatchers(INDEX);
  it('bevorzugt die TMDB-ID', () => {
    expect(matchEntry(m.seriesByTmdb, m.seriesByTitle, 258348, 'Irgendwas')).toMatchObject({ item: { id: 'jf-clev' }, match: 'tmdb' });
  });
  it('fällt auf den Titel zurück, wenn die Bibliothek keine TMDB-ID hat', () => {
    expect(matchEntry(m.seriesByTmdb, m.seriesByTitle, 999, 'Skeleton Knight in Another World')).toMatchObject({ item: { id: 'jf-notag' }, match: 'title' });
  });
  it('löst Titel-Dubletten über das Jahr auf', () => {
    expect(matchEntry(m.seriesByTmdb, m.seriesByTitle, null, 'One Piece (2023)', 2023)).toMatchObject({ item: { id: 'jf-op-2' } });
    expect(matchEntry(m.seriesByTmdb, m.seriesByTitle, null, 'One Piece')).toMatchObject({ item: { id: 'jf-op-1' } });
  });
  it('liefert null ohne Treffer', () => {
    expect(matchEntry(m.seriesByTmdb, m.seriesByTitle, null, 'Gibt es nicht')).toBeNull();
  });
  it('findet die deutsch benannte Serie über den englischen Ordnernamen', () => {
    expect(matchEntry(m.seriesByTmdb, m.seriesByTitle, 118541, 'That Time I Got Reincarnated as a Slime')).toMatchObject({ item: { id: 'jf-slime' }, match: 'title' });
  });
  it('findet die Serie über die weiteren TMDB-Namen (deutsch/Original), wenn der Quell-Titel nicht passt', () => {
    const alt = ['Meine Wiedergeburt als Schleim in einer anderen Welt', '転生したらスライムだった件'];
    expect(matchEntry(m.seriesByTmdb, m.seriesByTitle, null, 'Tensei Shitara Slime Datta Ken', null, alt)).toMatchObject({ item: { id: 'jf-slime' }, match: 'title' });
    expect(matchEntry(m.seriesByTmdb, m.seriesByTitle, null, 'Tensei Shitara Slime Datta Ken', null, ['Nix'])).toBeNull();
  });
});

describe('folderTitle', () => {
  it('bereinigt Ordnernamen um ID-Tags und Jahr', () => {
    expect(folderTitle('/localmedia/serien/That Time I Got Reincarnated as a Slime [tmdbid-82684]')).toEqual(['That Time I Got Reincarnated as a Slime']);
    expect(folderTitle('D:\\Serien\\One Piece (1999) [tvdbid-81797]\\')).toEqual(['One Piece']);
    // Filme: Path zeigt auf die Datei — Datei + Filmordner zählen, die Bibliothekswurzel nicht
    expect(folderTitle('/filme/Deadpool & Wolverine (2024) {tmdb-533535}/Deadpool.and.Wolverine.2024.mkv', 'Movie')).toEqual(['Deadpool.and.Wolverine.2024', 'Deadpool & Wolverine']);
    expect(folderTitle('/filme/Flat Movie (2020).mkv', 'Movie')).toEqual(['Flat Movie']);
    expect(folderTitle('/serien/Clevatess [tmdbid-258348]', 'Series')).toEqual(['Clevatess']);
    expect(folderTitle(null)).toEqual([]);
    expect(folderTitle('')).toEqual([]);
  });
});

describe('reconcileItems', () => {
  it('markiert vorhanden / fehlend / Staffel fehlt / Serie fehlt und summiert je Staffel nur einmal', async () => {
    const items = [
      { title: 'Clevatess — S02 E11', url: 'u1', series_title: 'Clevatess', series_url: 's-clev', tmdb_id: 258348, ref: { kind: 'episode', season: 2, episode: 11 } },
      { title: 'Clevatess — S02 E10', url: 'u2', series_title: 'Clevatess', series_url: 's-clev', tmdb_id: 258348, ref: { kind: 'episode', season: 2, episode: 10 } },
      { title: 'Clevatess — S03 E02', url: 'u3', series_title: 'Clevatess', series_url: 's-clev', tmdb_id: 258348, ref: { kind: 'episode', season: 3, episode: 2 } },
      { title: 'Skeleton Knight — S02 E11', url: 'u4', series_title: 'Skeleton Knight in Another World', series_url: 's-sk', tmdb_id: 12345, ref: { kind: 'episode', season: 2, episode: 11 } },
      { title: 'Skeleton Knight — S02 E08', url: 'u5', series_title: 'Skeleton Knight in Another World', series_url: 's-sk', tmdb_id: 12345, ref: { kind: 'episode', season: 2, episode: 8 } },
      { title: 'Unbekannt — S01 E01', url: 'u6', series_title: 'Unbekannt', series_url: 's-unk', tmdb_id: null, ref: { kind: 'episode', season: 1, episode: 1 } },
      { title: 'One Piece — Film 3', url: 'u7', series_title: 'One Piece', series_url: 's-op', tmdb_id: 37854, ref: { kind: 'film', number: 3 } },
      { title: 'Deadpool & Wolverine (2024)', url: 'u8', series_title: 'Deadpool & Wolverine', year: 2024, tmdb_id: 533535, ref: { kind: 'movie' } },
      { title: 'Neuer Film (2026)', url: 'u9', series_title: 'Neuer Film', year: 2026, tmdb_id: 777, ref: { kind: 'movie' } },
      { title: 'Ohne Bezug', url: 'u10' },
    ] as any[];
    const summary = await reconcileItems(items, INDEX, getEpisodes, urlOf);

    expect(items[0].library).toMatchObject({ status: 'present', match: 'tmdb', have_until: 11, missing: [], missing_count: 0, url: urlOf('jf-clev') });
    expect(items[1].library).toMatchObject({ status: 'present', missing_count: 0 });
    expect(items[2].library).toMatchObject({ status: 'season_missing', have_until: null, missing: [1, 2], missing_count: 2 });
    // Titel-Fallback: E11 fehlt, außerdem Lücke bei E04 und E09–E10
    expect(items[3].library).toMatchObject({ status: 'missing', match: 'title', have_until: 8, missing: [4, 9, 10, 11], missing_count: 4 });
    expect(items[4].library).toMatchObject({ status: 'present', missing_count: 4 }); // da, aber Staffel hat Lücken
    expect(items[5].library).toMatchObject({ status: 'series_missing', missing_count: 0 });
    expect(items[6].library.status).toBe('unknown');
    expect(items[7].library).toMatchObject({ status: 'present', match: 'tmdb', url: urlOf('jf-dp') });
    expect(items[8].library).toMatchObject({ status: 'series_missing', missing_count: 1 });
    expect(items[9].library).toBeUndefined();

    // Clevatess S02: 0, S03: 2, Skeleton S02: 4 (einmal, nicht je Zeile), Film fehlt: 1
    expect(summary).toEqual({ checked: 8, missing_total: 7, series_matched: 2 });
  });

  it('lässt eine Serie mit Ladefehler als unknown stehen, ohne die anderen zu stören', async () => {
    const items = [
      { title: 'One Piece — S22 E03', series_title: 'One Piece', series_url: 's-op', tmdb_id: 111110, ref: { kind: 'episode', season: 22, episode: 3 } },
      { title: 'Clevatess — S02 E11', series_title: 'Clevatess', series_url: 's-clev', tmdb_id: 258348, ref: { kind: 'episode', season: 2, episode: 11 } },
    ] as any[];
    const summary = await reconcileItems(items, INDEX, getEpisodes, urlOf); // jf-op-2 hat keine Episodenliste -> boom
    expect(items[0].library.status).toBe('unknown');
    expect(items[0].library.note).toMatch(/boom/);
    expect(items[1].library.status).toBe('present');
    expect(summary.missing_total).toBe(0);
  });
});

describe('hashableView + canonicalJson', () => {
  it('Bibliotheksfelder ändern den Hash nicht, Inhaltsänderungen schon', () => {
    const base = { count: 1, items: [{ title: 'A — S01 E01', url: 'u', ref: { kind: 'episode', season: 1, episode: 1 } }], newest_title: 'A' };
    const withLib = { ...base, library_checked: 1, library_missing_total: 3, library_error: null, items: [{ ...base.items[0], library: { status: 'missing', missing_count: 3 } }] };
    expect(canonicalJson(hashableView(withLib))).toBe(canonicalJson(hashableView(base)));
    const changed = { ...base, items: [{ ...base.items[0], title: 'A — S01 E02' }] };
    expect(canonicalJson(hashableView(changed))).not.toBe(canonicalJson(hashableView(base)));
  });
  it('sortiert Schlüssel auf jeder Ebene', () => {
    expect(canonicalJson({ b: { z: 1, a: [{ y: 2, x: 1 }] }, a: 0 })).toBe('{"a":0,"b":{"a":[{"x":1,"y":2}],"z":1}}');
  });
});
