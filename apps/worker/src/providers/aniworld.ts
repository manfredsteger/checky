// AniWorld „Neue Episoden"-Provider (kind:api). Liest /neue-episoden, die
// gemeinsame Release-Liste für neue Episoden UND neue Serien (jede Zeile ist
// EIN konkretes Sprach-Release einer Episode — Titel, Episodennummer, Datum,
// Sprach-Flagge, optional "Neu!"-Markierung).
//
// Vorgänger-Ansatz war /neu (nur Serientitel, hart auf 20 Einträge gedeckelt,
// keine Sprachangabe direkt — brauchte einen Zusatz-Abruf JE Titel). Diese
// Seite hier liefert bis zu 150+ Einträge in EINEM einzigen Abruf, inklusive
// exakter Sprachangabe pro Zeile — kein Fan-out auf Serienseiten mehr nötig.
//
// Bewusst OHNE Playwright: aniworld.to liefert das Markup einem einfachen
// HTTP-GET ohne Anti-Bot-Hürde aus (per curl verifiziert, HTTP 200 mit echtem
// Inhalt).
//
// Kein HTML-Parser als Abhängigkeit: Die Seite hat eine sehr stabile, enge
// Struktur pro Zeile (Anker mit Titel/Episode/Datum, direkt gefolgt vom
// Flaggen-<img data-src="…svg">, optional gefolgt vom "Neu!"-Badge) — dafür
// reicht ein gezielter Regex.

const BASE = 'https://aniworld.to';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

async function fetchHtml(path: string): Promise<string> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'user-agent': UA, 'accept-language': 'de-DE,de;q=0.9' },
  });
  if (!res.ok) throw new Error(`AniWorld HTTP ${res.status} bei ${path}`);
  return res.text();
}

// Titel/Episodenlabel stecken als rohes HTML entity-kodiert im Markup —
// verbreitete Entities decodieren, sonst steht z.B. "Aren&#039;t Wicked"
// statt "Aren't Wicked" da.
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'")
    .replace(/&uuml;/g, 'ü').replace(/&ouml;/g, 'ö').replace(/&auml;/g, 'ä').replace(/&szlig;/g, 'ß');
}

// Flaggen-Dateiname -> Klartext-Sprache. Nur die drei bislang beobachteten
// (german/japanese-german/japanese-english) sind bekannt; alles andere wird
// roh durchgereicht statt verschluckt (neue Flagge auf der Seite soll
// sichtbar bleiben, nicht stumm rausfallen).
const FLAG_LABEL: Record<string, string> = {
  'german': 'Dub',
  'japanese-german': 'Sub',
  'japanese-english': 'EN-Sub',
  'english': 'EN-Dub',
  'japanese': 'Raw (JP)',
};

function languageOf(flagPath: string): string {
  const key = (flagPath.match(/\/([a-z-]+)\.svg$/i)?.[1] || '').toLowerCase();
  return FLAG_LABEL[key] || key || 'unbekannt';
}

interface EpisodeRow {
  title: string;
  url: string;
  episode: string;   // z.B. "S01 E19"
  date: string;       // z.B. "Di, 25.08.2026"
  language: string;   // "Dub" | "Sub" | "EN-Sub" | …
  isNew: boolean;
}

// Genre steht nicht in der Episodenliste, sondern nur auf der Serienseite
// (`.../anime/stream/<slug>`, ohne Staffel/Episode-Suffix). Der `genres`-Block
// dort listet Genres UND Sprachverfügbarkeit als gleichrangige "Tags"
// (Ger/GerSub/EngSub) — die Sprach-Tags fliegen raus, wir zeigen die Sprache
// ja schon separat aus der Episodenliste.
const GENRE_SLUG_EXCLUDE = new Set(['ger', 'gersub', 'engsub', 'engdub', 'dub', 'sub']);

function seriesBaseUrl(episodeUrl: string): string {
  return episodeUrl.match(/^(https:\/\/aniworld\.to\/anime\/stream\/[^/]+)/)?.[1] || episodeUrl;
}

function parseGenres(html: string): string[] {
  const section = html.match(/<div class="genres">([\s\S]*?)<\/ul>/)?.[1] || '';
  const genres: string[] = [];
  const re = /<a href="\/genre\/([a-z0-9-]+)" class="genreButton[^"]*"[^>]*>([^<]+)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(section))) {
    if (!GENRE_SLUG_EXCLUDE.has(m[1].toLowerCase())) genres.push(decodeEntities(m[2].trim()));
  }
  return genres;
}

// Eine Serienseite je eindeutiger Serie (nicht je Episode) — "One Piece"
// taucht z.B. vierfach in der Episodenliste auf, soll aber nur einmal
// abgerufen werden. Sequenziell mit kleiner Pause aus Rücksicht auf den
// Server, ein einzelner Fehlschlag lässt nur diese eine Serie ohne Genres
// da statt den ganzen Lauf scheitern zu lassen.
async function fetchGenresBySeries(seriesUrls: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (const url of seriesUrls) {
    try {
      map.set(url, parseGenres(await fetchHtml(url.replace(BASE, ''))));
    } catch {
      map.set(url, []);
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return map;
}

// Eine Zeile der Liste: Anker (Titel+Episode+Datum), direkt gefolgt vom
// Flaggen-Icon, optional gefolgt vom grünen "Neu!"-Badge.
const ROW_RE = new RegExp(
  '<a href="(/anime/stream/[^"]+)">\\s*' +
  '<strong>([^<]+)</strong>\\s*' +
  '<span class="listTag bigListTag[^"]*">([^<]+)</span>\\s*' +
  '<span class="elementFloatRight">([^<]+)</span>\\s*' +
  '</a>\\s*' +
  '<img class="flag"[^>]*data-src="([^"]+)"[^>]*>' +
  '(?:\\s*<noscript>.*?</noscript>)?\\s*' +
  '(<span class="listTag bigListTag green right">Neu!</span>)?',
  'gs',
);

function parseEpisodeList(html: string): EpisodeRow[] {
  const rows: EpisodeRow[] = [];
  let m: RegExpExecArray | null;
  ROW_RE.lastIndex = 0;
  while ((m = ROW_RE.exec(html))) {
    const [, href, rawTitle, episode, date, flagPath, neuBadge] = m;
    rows.push({
      title: decodeEntities(rawTitle.trim()),
      url: `${BASE}${href}`,
      episode: episode.trim(),
      date: date.trim(),
      language: languageOf(flagPath),
      isNew: !!neuBadge,
    });
  }
  return rows;
}

function matchesFilter(language: string, mode: string): boolean {
  if (mode === 'Alle Sprachen') return true;
  if (mode === 'Nur deutsche Untertitel') return language === 'Sub';
  // "Nur deutscher Dub" und "Nur Dub, absolut keine Untertitel nötig" sind
  // auf dieser Seite gleichbedeutend: jede Zeile ist bereits EIN konkretes
  // Sprach-Release (nicht mehr eine ganze Serie mit gemischten Episoden wie
  // beim alten /neu-Ansatz) — eine als "Dub" markierte Zeile verlangt schon
  // per Definition keine Untertitel.
  if (mode === 'Nur deutscher Dub' || mode === 'Nur Dub, absolut keine Untertitel nötig') return language === 'Dub';
  return language === 'Dub' || language === 'Sub'; // 'Deutsch (Dub oder Sub)' (Default)
}

export async function fetchAniworld(params: Record<string, any>): Promise<Record<string, any>> {
  const mode = String(params.sprache || 'Deutsch (Dub oder Sub)');

  const html = await fetchHtml('/neue-episoden');
  const all = parseEpisodeList(html);
  if (!all.length) {
    throw new Error('AniWorld: /neue-episoden lieferte keine Einträge — Seitenstruktur hat sich vermutlich geändert');
  }

  // limit begrenzt, wie viele der geladenen Zeilen ausgewertet werden — die
  // Seite selbst liefert immer ihre volle aktuelle Liste (aktuell ~150) in
  // einem Abruf, `available_total` macht die tatsächliche Seitengröße
  // sichtbar statt sie zu erraten.
  const limit = Number(params.limit) > 0 ? Math.min(Number(params.limit), all.length) : all.length;
  const candidates = all.slice(0, limit);

  const matches = candidates.filter(r => matchesFilter(r.language, mode));

  const uniqueSeriesUrls = Array.from(new Set(matches.map(r => seriesBaseUrl(r.url))));
  const genresBySeries = await fetchGenresBySeries(uniqueSeriesUrls);

  return {
    count: matches.length,
    items: matches.map(r => ({
      title: `${r.title} — ${r.episode}`,
      url: r.url,
      languages: [r.language],
      genres: genresBySeries.get(seriesBaseUrl(r.url)) || [],
      date: r.date,
      is_new: r.isNew,
    })),
    newest_title: matches[0]?.title ?? null,
    newest_url: matches[0]?.url ?? null,
    checked_total: candidates.length,
    available_total: all.length,
  };
}
