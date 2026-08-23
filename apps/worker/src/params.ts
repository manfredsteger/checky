// --- Abgeleitete Parameter ---------------------------------------------------
// Deep-Link-URLs brauchen Bausteine, die sich aus den Nutzer-Parametern ergeben,
// aber nicht 1:1 darin stehen (Pax-Pfadsegment, Filter-Ausdruck, Minuten statt
// Stunden). Diese hier zu berechnen hält die Blueprints lesbar — sonst müsste
// der Nutzer dieselbe Angabe zweimal pflegen.

function num(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function deriveParams(params: Record<string, any>): Record<string, any> {
  const p = { ...(params || {}) };

  const adults = num(p.adults) ?? 1;
  const children = num(p.children) ?? 0;
  const infants = num(p.infants) ?? 0;
  const maxStops = num(p.max_stops);
  const maxDurH = num(p.max_duration_h);

  p.pax_total = adults + children + infants;
  // Zaehler-Widgets starten bei 1 Erwachsenem / 0 Kindern: so oft auf „+" klicken.
  p.adults_clicks = Math.max(adults - 1, 0);
  p.children_clicks = Math.max(children, 0);

  // URL-basierte Quellen (Kayak & Co.) brauchen einen Flughafen-/Stadtcode im
  // Pfad, während API-Quellen (Kiwi) auch mit „Tokio" umgehen. Deshalb eigene
  // *_code-Parameter: explizit gesetzt gewinnt, sonst der Wert selbst, wenn er
  // schon wie ein IATA-Code aussieht.
  const asCode = (explicit: any, raw: any): string => {
    const e = String(explicit ?? '').trim();
    if (e) return e.toUpperCase();
    const r = String(raw ?? '').trim();
    return /^[A-Za-z]{3}$/.test(r) ? r.toUpperCase() : r;
  };
  p.origin_code = asCode(p.origin_code, p.origin);
  p.dest_code = asCode(p.dest_code, p.dest);

  // Check24 hängt an den Code die Art des Ortes: -A = einzelner Flughafen,
  // -C = Stadt (alle Flughäfen). Default passt zum Normalfall „von einem
  // bestimmten Flughafen in eine Stadt"; per origin_kind/dest_kind änderbar.
  const kind = (v: any, dflt: string) => (String(v ?? '').trim().toUpperCase() === 'C' ? 'C'
    : String(v ?? '').trim().toUpperCase() === 'A' ? 'A' : dflt);
  // Gabelflug (open jaw): hin nach A, zurück ab B. Ohne eigene Angabe ist beides
  // das normale Ziel — dann verhält sich alles wie ein gewöhnlicher Hin-/Rückflug.
  p.dest_out_code = asCode(p.dest_out_code, p.dest_out) || p.dest_code;
  p.origin_in_code = asCode(p.origin_in_code, p.origin_in) || p.dest_code;

  p.origin_c24 = `${p.origin_code}-${kind(p.origin_kind, 'A')}`;
  p.dest_c24 = `${p.dest_code}-${kind(p.dest_kind, 'C')}`;

  // Unix-Zeitstempel (Mitternacht UTC) — billigfluege.de/fluege.de erwarten das
  // Reisedatum so in der URL statt als ISO-Datum.
  const epoch = (iso: any): string => {
    const t = Date.parse(`${String(iso ?? '').trim()}T00:00:00Z`);
    return Number.isFinite(t) ? String(Math.floor(t / 1000)) : '';
  };
  p.outbound_ts = epoch(p.outbound);
  p.inbound_ts = epoch(p.inbound);

  // Kompaktdatum YYYYMMDD — so erwartet es lastminute.de in der URL.
  const compact = (iso: any): string => String(iso ?? '').replace(/-/g, '');
  p.outbound_compact = compact(p.outbound);
  p.inbound_compact = compact(p.inbound);

  // Deutsches Langdatum „1. Januar 2027" — react-dates-Kalender (Lufthansa)
  // beschriften ihre Tageszellen so im aria-label.
  const MONTHS_DE = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
  const longDe = (iso: any): string => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? '').trim());
    if (!m) return '';
    return `${Number(m[3])}. ${MONTHS_DE[Number(m[2]) - 1]} ${m[1]}`;
  };
  p.outbound_de = longDe(p.outbound);
  p.inbound_de = longDe(p.inbound);

  // Kindesalter: die meisten Quellen preisen altersabhängig (ein 6-Jähriger
  // zahlt weniger als ein 11-Jähriger). Als Liste angeben, z.B. "6" oder "6,9".
  const ages = String(p.child_ages ?? '')
    .split(/[,;\s]+/).map(x => x.trim()).filter(x => /^\d{1,2}$/.test(x)).slice(0, 9);
  // Fehlt die Altersangabe, aber es reisen Kinder mit: mit 10 rechnen — das ist
  // die teurere Annahme und meldet lieber zu viel als zu wenig.
  while (ages.length < children) ages.push('10');
  ages.length = Math.min(ages.length, children);
  p.child_age_list = ages.join(',');

  // Pfadsegment der Kayak-Familie (kayak/swoodoo/momondo).
  // ACHTUNG: „1children" wird dort STILL IGNORIERT — die Seite zeigt dann nur
  // die Erwachsenen. Verlangt wird die Altersliste: „children-10". Nachgemessen
  // am 23.08.2026: /2adults/1children -> „2 Reisende", /2adults/children-10 ->
  // „3 Reisende".
  p.pax_path = [`${adults}adults`, ages.length ? `children-${ages.join('-')}` : '']
    .filter(Boolean).join('/');

  // Datums-Spielraum. Ein einziger Tag Toleranz ändert bei Fernflügen alles:
  // BER→JFK nonstop kostet am exakten Termin 850 €/P, mit ±1 Tag 620 €.
  // Kayak & Co. hängen das als Suffix an das Datum im Pfad.
  const flex = num(p.flex_days);
  p.date_flex = flex && flex > 0
    ? (flex === 1 ? '-flexible-1day' : `-flexible-${Math.min(flex, 3)}days`)
    : '';
  p.flexible_yesno = flex && flex > 0 ? 'true' : 'false';
  p.flex_shift = flex && flex > 0 ? String(Math.min(flex, 3)) : '0';

  // Rückflug-Segment: leer = Nur-Hinflug (One-Way-URL).
  p.inbound_seg = p.inbound ? `/${p.inbound}${p.date_flex}` : '';

  // Filterausdruck der Kayak-Familie: max. Stopps und max. Flugdauer je Strecke.
  // Ohne Dauerbegrenzung gewinnen sonst 30-Stunden-Konstrukte mit Übernacht-
  // Aufenthalt den Preisvergleich (siehe „Phantomtarif"-Lektion).
  const fs: string[] = [];
  if (maxStops !== null) fs.push(`stops=~${maxStops}`);
  if (maxDurH !== null) fs.push(`legdur=-${Math.round(maxDurH * 60)}`);
  p.flight_filter = fs.join(';');
  p.max_duration_min = maxDurH !== null ? Math.round(maxDurH * 60) : '';

  return p;
}
