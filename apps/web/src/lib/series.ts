import type { Result } from '@checky/shared';

/**
 * Messreihen trennen.
 *
 * Ändert man die Suche (andere Route, anderes Datum, andere Reisendenzahl),
 * misst der Agent ab da etwas anderes. Die alten Werte bleiben erhalten — sie
 * waren ja richtig — gehören aber nicht in dieselbe Kurve: ein Sprung von
 * 4 auf 3 Reisende sähe sonst aus wie ein Preisverfall.
 *
 * Die jüngste Messung bestimmt, welche Reihe „die aktuelle" ist. Ergebnisse aus
 * der Zeit vor dieser Trennung haben keinen Schlüssel (null) und bilden
 * zusammen ebenfalls eine Reihe.
 *
 * @param results absteigend nach created_at sortiert (so liefert es die API)
 */
export function splitSeries(results: Result[] | undefined) {
  if (!results?.length) return { current: [] as Result[], older: [] as Result[], key: null as string | null };
  const key = results[0].search_key ?? null;
  const current: Result[] = [];
  const older: Result[] = [];
  for (const r of results) ((r.search_key ?? null) === key ? current : older).push(r);
  return { current, older, key };
}

/** Was war an der früheren Suche anders? Aus den mitgeschriebenen Parametern. */
export function diffToOlder(current: Result | undefined, older: Result | undefined): string[] {
  const a = (older?.search_params || {}) as Record<string, any>;
  const b = (current?.search_params || {}) as Record<string, any>;
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const out: string[] = [];
  for (const k of keys) {
    if (String(a[k] ?? '—') === String(b[k] ?? '—')) continue;
    out.push(`${k}: ${a[k] ?? '—'} → ${b[k] ?? '—'}`);
  }
  return out;
}
