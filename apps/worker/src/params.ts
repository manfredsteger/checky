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

  // Pfadsegment der Kayak-Familie (kayak/swoodoo/momondo):
  // „2adults/2children" bzw. nur „2adults", wenn keine Kinder mitreisen.
  p.pax_path = [`${adults}adults`, children > 0 ? `${children}children` : '']
    .filter(Boolean).join('/');

  // Rückflug-Segment: leer = Nur-Hinflug (One-Way-URL).
  p.inbound_seg = p.inbound ? `/${p.inbound}` : '';

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
