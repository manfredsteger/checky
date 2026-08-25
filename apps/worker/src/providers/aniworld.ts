// AniWorld „Neu"-Provider (kind:api). Liest die /neu-Übersicht (neu
// hinzugefügte Animes) und prüft je Titel die Serienseite auf die
// Sprach-Flaggen-Icons, um nur Einträge mit der gewünschten deutschen
// Sprachverfügbarkeit zu melden.
//
// Bewusst OHNE Playwright: aniworld.to liefert das Markup einem einfachen
// HTTP-GET ohne Anti-Bot-Hürde aus (per curl verifiziert, HTTP 200 mit echtem
// Inhalt) — ein Recipe/Browser-Lauf wäre hier nur unnötiger Overhead.
//
// Kein HTML-Parser als Abhängigkeit: Die Seite hat eine sehr stabile, enge
// Struktur (ein <a href="/anime/stream/…" title="…"> pro Karte, Flaggen als
// <img class="flag" src=".../german.svg"|".../japanese-german.svg">), dafür
// reichen gezielte Regexe.

const BASE = 'https://aniworld.to';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

async function fetchHtml(path: string): Promise<string> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'user-agent': UA, 'accept-language': 'de-DE,de;q=0.9' },
  });
  if (!res.ok) throw new Error(`AniWorld HTTP ${res.status} bei ${path}`);
  return res.text();
}

interface NeuItem { title: string; url: string; }

// Titel stecken als rohes HTML-Attribut im Markup — verbreitete Entities
// decodieren, sonst steht z.B. "Aren&#039;t Wicked" statt "Aren't Wicked" da.
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'")
    .replace(/&uuml;/g, 'ü').replace(/&ouml;/g, 'ö').replace(/&auml;/g, 'ä').replace(/&szlig;/g, 'ß');
}

// Jede Karte auf /neu: <a href="/anime/stream/<slug>" title="<Titel> stream online mit Schauspieler …">
// Titel + Link stecken beide im selben <a>-Tag, kein zweiter Anker pro Karte.
function parseNeuList(html: string): NeuItem[] {
  const re = /<a href="(\/anime\/stream\/[^"]+)" title="([^"]+?) stream online/g;
  const seen = new Set<string>();
  const items: NeuItem[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const [, href, rawTitle] = m;
    if (seen.has(href)) continue;
    seen.add(href);
    items.push({ title: decodeEntities(rawTitle.trim()), url: `${BASE}${href}` });
  }
  return items;
}

// Flaggen auf der Serienseite: german.svg = deutscher Dub, japanese-german.svg
// = deutsche Untertitel (Original-Ton + deutscher Sub). Beide können auf
// derselben Seite vorkommen (unterschiedliche Staffeln/Episoden).
function languagesOf(detailHtml: string): string[] {
  const langs: string[] = [];
  if (detailHtml.includes('german.svg')) langs.push('Dub');
  if (detailHtml.includes('japanese-german.svg')) langs.push('Sub');
  return langs;
}

function matchesFilter(languages: string[], mode: string): boolean {
  if (mode === 'Alle Sprachen') return true;
  // Am strengsten: Dub muss da sein UND nirgends auf der Seite darf eine
  // Sub-only-Episode auftauchen — sonst rutscht ein Titel durch, bei dem nur
  // die alten Episoden gedubbt sind, die neuen aber noch nicht (Untertitel-
  // Zwang bei den aktuellen Folgen). Das ist der Nutzerwunsch „ohne
  // Untertitel, ohne irgendwas".
  if (mode === 'Nur Dub, absolut keine Untertitel nötig') return languages.includes('Dub') && !languages.includes('Sub');
  if (mode === 'Nur deutscher Dub') return languages.includes('Dub');
  if (mode === 'Nur deutsche Untertitel') return languages.includes('Sub');
  return languages.length > 0; // 'Deutsch (Dub oder Sub)' (Default)
}

// /neu zeigt IMMER genau die 20 neuesten Einträge — keine Pagination, kein
// Query-Param wirkt (?page=2 liefert nachweislich dieselben 20 zurück, kein
// "mehr anzeigen"-Link im Markup). `limit` kann also nie mehr prüfen, als die
// Seite hergibt; `checked_total` im Ergebnis macht das ehrlich sichtbar.
const MAX_ON_PAGE = 20;

export async function fetchAniworld(params: Record<string, any>): Promise<Record<string, any>> {
  const mode = String(params.sprache || 'Deutsch (Dub oder Sub)');
  const limit = Number(params.limit) > 0 ? Math.min(Number(params.limit), MAX_ON_PAGE) : MAX_ON_PAGE;

  const listHtml = await fetchHtml('/neu');
  const candidates = parseNeuList(listHtml).slice(0, limit);
  if (!candidates.length) {
    throw new Error('AniWorld: /neu lieferte keine Einträge — Seitenstruktur hat sich vermutlich geändert');
  }

  const checked: (NeuItem & { languages: string[] })[] = [];
  let detailErrors = 0;
  for (const item of candidates) {
    try {
      const detail = await fetchHtml(item.url.replace(BASE, ''));
      checked.push({ ...item, languages: languagesOf(detail) });
    } catch {
      detailErrors++;
    }
    // Höflich bleiben — keine Anfragenflut gegen die Serienseiten.
    await new Promise(r => setTimeout(r, 300));
  }

  const matches = checked.filter(i => matchesFilter(i.languages, mode));

  const result: Record<string, any> = {
    count: matches.length,
    items: matches.map(i => ({ title: i.title, url: i.url, languages: i.languages })),
    newest_title: matches[0]?.title ?? null,
    newest_url: matches[0]?.url ?? null,
    checked_total: candidates.length,
  };
  // Ehrlich markieren statt still unvollständig liefern, falls einzelne
  // Serienseiten nicht lesbar waren — sonst könnte ein neuer Eintrag fehlen,
  // ohne dass das irgendwo sichtbar wird.
  if (detailErrors > 0) {
    result._suspect = `${detailErrors} von ${candidates.length} Serienseiten waren nicht lesbar — die Liste kann unvollständig sein.`;
  }
  return result;
}
