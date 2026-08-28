// TopStreamFilm-Provider (kind:api). Liest die Archiv-Liste /kinofilme/,
// die neueste zuerst zeigende Übersicht aller Filme (Dooplay-Theme) — echte
// Pagination via /kinofilme/page/N/ (verifiziert: Seite 2 liefert andere
// Titel, kein Duplikat-Bug wie einst bei AniWorlds /neu).
//
// Die Liste selbst nennt weder Sprache noch Genre noch das genaue
// Hinzufügedatum — die stecken nur auf der Detailseite jedes Films
// (`itemprop="dateCreated"`, der Player-Tab-Titel "Deutsch - HD"/"English -
// TS", der "Genre:"-Block). Ein Detail-Abruf pro Film liefert alle drei auf
// einmal, deshalb (anders als bei AniWorld) kein separates Dedup-Fanout
// nötig — hier ist ohnehin jeder Film einzigartig.
//
// Bewusst OHNE Playwright: topstreamfilm.live liefert das Markup einem
// einfachen HTTP-GET aus (Cloudflare cached HTML, kein Anti-Bot-Check
// getroffen, per curl verifiziert).

import { searchMovieRating } from './tmdb.js';

const BASE = 'https://www.topstreamfilm.live';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const PER_PAGE = 15; // beobachtete Archiv-Seitengröße

async function fetchHtml(path: string): Promise<string> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'user-agent': UA, 'accept-language': 'de-DE,de;q=0.9' },
  });
  if (!res.ok) throw new Error(`TopStreamFilm HTTP ${res.status} bei ${path}`);
  return res.text();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'")
    .replace(/&uuml;/g, 'ü').replace(/&ouml;/g, 'ö').replace(/&auml;/g, 'ä').replace(/&szlig;/g, 'ß');
}

interface ListRow {
  title: string;
  url: string;
  year: string;
}

// Ein Listeneintrag: Anker mit Detail-Link, dann (nach dem Bild) Titel +
// Jahr. Jeder Titel trägt als reines Theme-Anhängsel " – Der Film" — das ist
// kein Teil des echten Titels und wird abgeschnitten.
const ROW_RE = /<a href="(https:\/\/www\.topstreamfilm\.live\/kostenlos\/[^"]+)">\s*<div class="Image">[\s\S]*?<h3 class="Title">([^<]+)<\/h3>\s*<span class="Year">(\d{4})<\/span>/g;

function parseListPage(html: string): ListRow[] {
  const rows: ListRow[] = [];
  let m: RegExpExecArray | null;
  ROW_RE.lastIndex = 0;
  while ((m = ROW_RE.exec(html))) {
    const [, url, rawTitle, year] = m;
    rows.push({
      title: decodeEntities(rawTitle.trim()).replace(/\s*[–-]\s*Der Film$/, ''),
      url,
      year,
    });
  }
  return rows;
}

async function fetchAllListRows(limit: number): Promise<ListRow[]> {
  const rows: ListRow[] = [];
  const pages = Math.max(1, Math.ceil(limit / PER_PAGE));
  for (let page = 1; page <= pages; page++) {
    const path = page === 1 ? '/kinofilme/' : `/kinofilme/page/${page}/`;
    const html = await fetchHtml(path);
    const pageRows = parseListPage(html);
    if (!pageRows.length) break; // letzte Seite überschritten
    rows.push(...pageRows);
    if (rows.length >= limit) break;
  }
  return rows;
}

// Genre-Block mischt echte Genres mit der Katalog-Kategorie ("kinofilme")
// als gleichrangigen Link — die fliegt raus, ist kein Genre.
const GENRE_SLUG_EXCLUDE = new Set(['kinofilme', 'serien', 'demnachst']);

function parseGenres(html: string): string[] {
  const section = html.match(/<strong>Genre:\s*<\/strong>([\s\S]*?)<\/li>/)?.[1] || '';
  const genres: string[] = [];
  const re = /<a href="https:\/\/www\.topstreamfilm\.live\/([a-z0-9-]+)\/">([^<]+)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(section))) {
    if (!GENRE_SLUG_EXCLUDE.has(m[1].toLowerCase())) genres.push(decodeEntities(m[2].trim()));
  }
  return genres;
}

function parseLanguage(html: string): string {
  const label = html.match(/<li class="Button[^"]*"><span>[^<]*<\/span><span>([^<]*)<\/span><\/li>/)?.[1] || '';
  return label.split(' - ')[0]?.trim() || 'unbekannt';
}

function parseDateCreated(html: string): string {
  return html.match(/itemprop="dateCreated" content="([^"]+)"/)?.[1] || '';
}

interface DetailInfo {
  language: string;
  genres: string[];
  date: string;
}

async function fetchDetails(urls: string[]): Promise<Map<string, DetailInfo>> {
  const map = new Map<string, DetailInfo>();
  for (const url of urls) {
    try {
      const html = await fetchHtml(url.replace(BASE, ''));
      map.set(url, { language: parseLanguage(html), genres: parseGenres(html), date: parseDateCreated(html) });
    } catch {
      map.set(url, { language: 'unbekannt', genres: [], date: '' });
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return map;
}

function matchesFilter(language: string, mode: string): boolean {
  if (mode === 'Alle Sprachen') return true;
  // Die feiner abgestuften Modi ("Nur deutscher Dub" etc.) stammen aus dem
  // AniWorld-Sprachfilter und unterscheiden Dub/Sub — bei Filmen gibt es
  // diese Unterscheidung nicht, hier zählt nur: deutsche Tonspur ja/nein.
  return language.toLowerCase().startsWith('deutsch');
}

export async function fetchTopstreamfilm(params: Record<string, any>): Promise<Record<string, any>> {
  const mode = String(params.sprache || 'Deutsch (Dub oder Sub)');
  const limit = Number(params.limit) > 0 ? Math.round(Number(params.limit)) : 30;

  const rows = await fetchAllListRows(limit);
  if (!rows.length) {
    throw new Error('TopStreamFilm: /kinofilme/ lieferte keine Einträge — Seitenstruktur hat sich vermutlich geändert');
  }
  const candidates = rows.slice(0, limit);

  const details = await fetchDetails(candidates.map(r => r.url));

  const matches = candidates.filter(r => matchesFilter(details.get(r.url)?.language || '', mode));

  // TMDB-Bewertung erst NACH dem Sprachfilter abfragen — für die englischen
  // Cam-Rips, die sowieso rausfliegen, muss kein Request laufen.
  const ratings = new Map<string, number | null>();
  for (const r of matches) {
    const tmdb = await searchMovieRating(r.title, r.year);
    ratings.set(r.url, tmdb?.rating ?? null);
    await new Promise(res => setTimeout(res, 150));
  }

  const items = matches.map(r => {
    const info = details.get(r.url);
    return {
      title: `${r.title} (${r.year})`,
      url: r.url,
      languages: [info?.language || 'unbekannt'],
      genres: info?.genres || [],
      rating: ratings.get(r.url) ?? null,
      date: info?.date || r.year,
    };
  });

  return {
    count: items.length,
    items,
    newest_title: items[0]?.title ?? null,
    newest_url: items[0]?.url ?? null,
    checked_total: candidates.length,
    // available_total bewusst weggelassen: anders als bei AniWorld (eine
    // Seite = die volle aktuelle Liste) hat /kinofilme/ echte Pagination
    // (45+ Seiten) ohne verlässliche Gesamtzahl im Markup.
  };
}
