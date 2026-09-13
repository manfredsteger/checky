// LoveTorrent-Provider (kind:api). Liest die Startseite von lovetorrent.net
// („Most Recent", neueste zuerst, 30 Einträge je Seite, echte Pagination via
// /page/N/) bzw. eine Tag-Seite (/tags/<slug>/ + /tags/<slug>/page/N/).
//
// Die Seite ist ein DataLife-Engine-CMS und liegt KOMPLETT hinter „Antibot
// Cloud" (Bild-CAPTCHA, auch rss.xml/sitemap.xml). Wir umgehen das nicht: der
// Nutzer löst das Rätsel einmal selbst im Browser und hinterlegt den dabei
// gesetzten Cookie unter Einstellungen → Quellen-Zugänge. Der Worker reicht
// ihn je Lauf frisch durch (ctx.sources.lovetorrent_cookie). Der Cookie hält
// laut Antibot-Skript 7 Tage; danach liefert die Seite wieder die Rätsel-
// Seite — die erkennen wir und brechen mit klarer Meldung ab, statt still
// leere Ergebnisse zu speichern.
//
// Zwei Dinge sind dabei nachgemessen (13.09.2026, per curl):
//   1. Der Token ist an den User-Agent des lösenden Browsers gebunden — mit
//      einem anderen UA kommt trotz gültigem Cookie die Rätsel-Seite. Deshalb
//      liegt neben dem Cookie auch der Browser-UA in den Einstellungen.
//   2. Es braucht ZWEI Cookies: „veAnuQ=<Name>" (nennt den Namen des Token-
//      Cookies) und „<Name>=<Token>". Der Token allein reicht nicht.
//
// Ein Listeneintrag ist ein einziger Anker:
//   <a href="https://lovetorrent.net/<id>-<id>.html" class="item-thumb">
//     <div class="img-holder"> <img …> <div class="info">191.39 GB</div> … </div>
//     <div class="info-holder">
//       <div class="title">Voller Titel</div>
//       <div class="details"> …icon-calendar… <span class="text">Сегодня, 06:48</span>
//                             …icon-eye… <span class="text"><script>random</script> Seed</span>
//     </div>
//   </a>
// Datum kommt in DLE-Manier: „Сегодня, HH:MM" (heute), „Вчера, HH:MM"
// (gestern), sonst „D-MM-YYYY, HH:MM". Die Seed-Zahl ist REIN ZUFÄLLIG per
// JavaScript erzeugt (Math.random im Markup) — wird bewusst ignoriert.
//
// Die Site-Suche (do=search) lieferte in allen getesteten Varianten (POST,
// GET, mit/ohne Vollsuche-Felder) null Treffer — deshalb ist „suche" hier ein
// Titel-Filter über die geprüften neuesten Einträge, kein Server-Aufruf.
//
// ABER: Die Liste zeigt nur einen gekürzten Titel („Beispieltitel"). Der volle
// Titel steht erst auf der Detailseite im <title> — inklusive Studio, Genre-
// Liste und Format, z.B. „[Studio] Beispieltitel (Szene
// [Genre]) [2026 г., …, 1080p]".
// Begriffe  tauchen NUR dort auf (nachgemessen 13.09.2026:
// 5 von 60 neuesten Einträgen, 0 davon im Listen-Titel). Deshalb holt der
// Filter je Kandidat die Detailseite und prüft den vollen Titel. Ein
// prozessweiter Cache (URL → voller Titel; Titel ändern sich nicht) sorgt
// dafür, dass Folge-Läufe nur die seit dem letzten Lauf neuen Einträge
// nachladen — sonst wären es bei 600 Kandidaten 600 Abrufe alle 6 Stunden.

import type { ProviderContext } from './index.js';

const BASE = 'https://lovetorrent.net';
// Fallback, falls kein Browser-UA hinterlegt ist — muss zum Browser passen,
// in dem das Rätsel gelöst wurde (siehe Kopfkommentar).
const DEFAULT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';
const PER_PAGE = 30;
const MAX_PAGES = 20; // harte Obergrenze je Lauf (600 Einträge) — die Seite hat 9500+ Seiten

export class LovetorrentAuthError extends Error {}

// Der Nutzer trägt die Cookies als „Name=Wert; Name2=Wert2" ein; ein
// versehentlich mitkopiertes „Cookie: " oder ein abschließendes Semikolon
// stört nicht. Fehlt der Begleit-Cookie „veAnuQ", wird er aus dem Namen des
// Token-Cookies (30 Zeichen, gefolgt vom Token „<hex>-<zeit>-<zeit>") ergänzt.
export function normalizeCookie(raw: string | undefined): string {
  const pairs = String(raw || '').trim().replace(/^cookie:\s*/i, '')
    .split(';').map(p => p.trim()).filter(p => p.includes('='));
  const names = new Set(pairs.map(p => p.slice(0, p.indexOf('=')).trim()));
  const token = pairs.find(p => /^[A-Za-z0-9]{30}=[0-9a-f]{32}-\d+/.test(p));
  if (token && !names.has('veAnuQ')) pairs.unshift(`veAnuQ=${token.slice(0, token.indexOf('='))}`);
  return pairs.join('; ');
}

// Client-Hint-Header passend zum UA — Chrome schickt sie immer mit; ein UA
// „Chrome/154" ohne sec-ch-ua wäre ein vermeidbarer Widerspruch.
function clientHintHeaders(ua: string): Record<string, string> {
  const major = ua.match(/Chrome\/(\d+)/)?.[1];
  if (!major) return {};
  const platform = /Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : 'Linux';
  return {
    'sec-ch-ua': `"Chromium";v="${major}", "Google Chrome";v="${major}", "Not-A.Brand";v="99"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': `"${platform}"`,
  };
}

function looksLikeAntibotPage(html: string): boolean {
  return /\/antibot\/index\.php/.test(html) || /Antibot Cloud/i.test(html);
}

async function fetchHtml(path: string, cookie: string, ua: string): Promise<string> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'user-agent': ua,
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
      ...clientHintHeaders(ua),
      'cookie': cookie,
    },
  });
  if (!res.ok) throw new Error(`LoveTorrent HTTP ${res.status} bei ${path}`);
  const html = await res.text();
  if (looksLikeAntibotPage(html)) {
    throw new LovetorrentAuthError(
      'LoveTorrent: Antibot-Cookie fehlt, ist abgelaufen oder passt nicht zum hinterlegten User-Agent — ' +
      'lovetorrent.net im Browser öffnen, Bild-Rätsel lösen und Cookie + User-Agent unter Einstellungen → Quellen-Zugänge eintragen.'
    );
  }
  return html;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'")
    .replace(/&uuml;/g, 'ü').replace(/&ouml;/g, 'ö').replace(/&auml;/g, 'ä').replace(/&szlig;/g, 'ß');
}

export interface Row {
  title: string;
  url: string;
  size: string;
  date: string;   // "DD.MM.YYYY HH:MM"
  dateRaw: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

// „Сегодня, 06:48" / „Вчера, 06:48" / „6-09-2026, 11:51" → „13.09.2026 06:48".
// Die Uhrzeit ist Site-Zeit; wir rechnen sie nicht um, sondern nehmen sie
// als Beschriftung mit. Heute/Gestern beziehen sich auf den Lauf-Zeitpunkt.
export function normalizeDate(raw: string, now: Date = new Date()): string {
  const s = raw.replace(/\s+/g, ' ').trim();
  let m = s.match(/^(Сегодня|Вчера|Today|Yesterday)\s*,?\s*(\d{1,2}):(\d{2})$/i);
  if (m) {
    const d = new Date(now);
    if (/Вчера|Yesterday/i.test(m[1])) d.setDate(d.getDate() - 1);
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(Number(m[2]))}:${m[3]}`;
  }
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})\s*,?\s*(\d{1,2}):(\d{2})$/);
  if (m) return `${pad(Number(m[1]))}.${pad(Number(m[2]))}.${m[3]} ${pad(Number(m[4]))}:${m[5]}`;
  return s;
}

const ROW_RE = /<a href="(https:\/\/lovetorrent\.net\/\d+-\d+\.html)" class="item-thumb">([\s\S]*?)<\/a>/g;

export function parseListPage(html: string, now: Date = new Date()): Row[] {
  const rows: Row[] = [];
  let m: RegExpExecArray | null;
  ROW_RE.lastIndex = 0;
  while ((m = ROW_RE.exec(html))) {
    const [, url, body] = m;
    const title = decodeEntities((body.match(/<div class="title">([\s\S]*?)<\/div>/)?.[1] || '').replace(/\s+/g, ' ').trim());
    if (!title) continue;
    const size = (body.match(/<div class="info">([\s\S]*?)<\/div>/)?.[1] || '').replace(/<[^>]+>/g, '').trim();
    const dateRaw = (body.match(/icon-calendar[\s\S]*?<span class="text">([\s\S]*?)<\/span>/)?.[1] || '').replace(/<[^>]+>/g, '').trim();
    rows.push({ title, url, size, date: normalizeDate(dateRaw, now), dateRaw });
  }
  return rows;
}

// „Showing <em>166204</em> submitted torrent." ist die GLOBALE Zahl und
// steht unverändert auch auf Tag-Seiten. Für einen Tag zählt nur der Tag-Link
// der Tag-Leiste (title="Найдено публикаций: N", nur auf der Startseite
// sicher vorhanden) — fehlt er, lieber gar keine Gesamtzahl als die falsche.
export function parseAvailableTotal(html: string, tagSlug: string | null): number | null {
  if (tagSlug) {
    const esc = tagSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const n = html.match(new RegExp(`href="/tags/${esc}/"[^>]*title="[^"]*?(\\d+)"`, 'i'))?.[1];
    return n ? Number(n) : null;
  }
  const n = html.match(/Showing\s*<em>(\d+)<\/em>/)?.[1];
  return n ? Number(n) : null;
}

// Tag-Eingabe → URL-Slug: die Seite nutzt Kleinbuchstaben-Slugs („1080p",
// „ultra-hd"). Ein eingegebener Anzeigename („Ultra HD")
// wird entsprechend umgeformt; ein fertiger Slug bleibt unverändert.
export function tagSlug(input: string): string | null {
  const s = String(input || '').trim().toLowerCase().replace(/^\/?tags\//, '').replace(/\/+$/, '');
  if (!s) return null;
  return s.replace(/\s+/g, '-');
}

// Titel-Filter: alle Wörter des Suchbegriffs müssen (case-insensitiv) im
// Titel vorkommen — Reihenfolge egal.
export function matchesSearch(title: string, search: string): boolean {
  const words = String(search || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const t = title.toLowerCase();
  return words.every(w => t.includes(w));
}

// Voller Titel aus der Detailseite: <title>… » Lovetorrent</title>. Das
// Theme-Anhängsel und das bei manchen Einträgen angefügte „- free sex video"
// sind kein Teil des Titels.
export function parseFullTitle(html: string): string | null {
  const raw = html.match(/<title>([\s\S]*?)<\/title>/)?.[1];
  if (!raw) return null;
  const t = decodeEntities(raw).replace(/\s*»\s*Lovetorrent\s*$/i, '').replace(/\s*-\s*free sex video\s*$/i, '').replace(/\s+/g, ' ').trim();
  return t || null;
}

// URL → voller Titel. Lebt so lange wie der Worker-Prozess; ein Kaltstart
// lädt einmal alle Kandidaten nach, danach nur noch die neuen.
const fullTitleCache = new Map<string, string>();
export const _fullTitleCacheForTests = fullTitleCache;

async function fullTitleOf(url: string, cookie: string, ua: string): Promise<string | null> {
  const cached = fullTitleCache.get(url);
  if (cached !== undefined) return cached;
  try {
    const html = await fetchHtml(url.replace(BASE, ''), cookie, ua);
    const t = parseFullTitle(html);
    if (t) fullTitleCache.set(url, t);
    return t;
  } catch (e) {
    if (e instanceof LovetorrentAuthError) throw e; // abgelaufener Cookie: sofort abbrechen, nicht 600× versuchen
    return null;
  } finally {
    await new Promise(r => setTimeout(r, 250));
  }
}

export async function fetchLovetorrent(params: Record<string, any>, ctx: ProviderContext): Promise<Record<string, any>> {
  const cookie = normalizeCookie(ctx?.sources?.lovetorrent_cookie);
  const ua = String(ctx?.sources?.lovetorrent_user_agent || '').trim() || DEFAULT_UA;
  if (!cookie) {
    throw new LovetorrentAuthError(
      'LoveTorrent: kein Antibot-Cookie hinterlegt — lovetorrent.net im Browser öffnen, Bild-Rätsel lösen ' +
      'und den Cookie unter Einstellungen → Quellen-Zugänge eintragen.'
    );
  }
  const limit = Number(params.limit) > 0 ? Math.round(Number(params.limit)) : 60;
  const slug = tagSlug(params.tag);
  const search = String(params.suche || '').trim();

  const basePath = slug ? `/tags/${encodeURIComponent(slug)}/` : '/';
  const pages = Math.min(MAX_PAGES, Math.max(1, Math.ceil(limit / PER_PAGE)));

  const rows: Row[] = [];
  let availableTotal: number | null = null;
  const now = new Date();
  for (let page = 1; page <= pages; page++) {
    const path = page === 1 ? basePath : `${basePath}page/${page}/`;
    const html = await fetchHtml(path, cookie, ua);
    if (page === 1) availableTotal = parseAvailableTotal(html, slug);
    const pageRows = parseListPage(html, now);
    if (!pageRows.length) {
      if (page === 1) {
        throw new Error(slug
          ? `LoveTorrent: Tag-Seite /tags/${slug}/ lieferte keine Einträge — Tag unbekannt oder Seitenstruktur geändert`
          : 'LoveTorrent: Startseite lieferte keine Einträge — Seitenstruktur hat sich vermutlich geändert');
      }
      break; // letzte Seite überschritten
    }
    rows.push(...pageRows);
    if (rows.length >= limit) break;
    await new Promise(r => setTimeout(r, 300));
  }

  // Doppelte URLs (Einträge, die während des Blätterns nachrücken) entfernen.
  const seen = new Set<string>();
  const candidates = rows.filter(r => (seen.has(r.url) ? false : (seen.add(r.url), true))).slice(0, limit);

  // Ohne Suchbegriff reicht die Liste. Mit Suchbegriff entscheidet der volle
  // Detailseiten-Titel (siehe Kopfkommentar); Treffer tragen dann diesen
  // vollen Titel, weil er das Wesentliche (Studio, Genre, Format) erst nennt.
  let detailsFetched = 0;
  const matches: Array<Row & { fullTitle?: string }> = [];
  for (const r of candidates) {
    if (!search) { matches.push(r); continue; }
    const before = fullTitleCache.has(r.url);
    const full = await fullTitleOf(r.url, cookie, ua);
    if (!before && full) detailsFetched++;
    if (matchesSearch(full ? `${r.title} ${full}` : r.title, search)) matches.push({ ...r, fullTitle: full || undefined });
  }

  const items = matches.map(r => ({
    title: r.fullTitle || r.title,
    url: r.url,
    size: r.size,
    date: r.date,
  }));

  return {
    count: items.length,
    items,
    newest_title: items[0]?.title ?? null,
    newest_url: items[0]?.url ?? null,
    checked_total: candidates.length,
    ...(availableTotal != null ? { available_total: availableTotal } : {}),
    ...(slug ? { tag: slug } : {}),
    ...(search ? { suche: search, details_fetched: detailsFetched } : {}),
  };
}
