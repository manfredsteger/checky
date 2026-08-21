import type { Manifest } from '@checky/shared';

// Manifest-getriebene Ergebnis-Darstellung.
// Ein Manifest beschreibt via `display`, welches Feld die Kennzahl ist
// (headline), welche Einheit gilt und welche Parameter Wunsch-/Schmerzgrenze
// definieren. Dieser Helper übersetzt das + die Projekt-/Agent-Parameter in
// konkrete Anzeigewerte — ohne dass die UI etwas über „Flug" oder „Heizöl"
// wissen muss.

export interface SecondaryField { field: string; label?: string; suffix?: string; }

export interface DisplayConfig {
  headline?: string;      // Ergebnis-Feld, das als Kennzahl gezeigt wird
  chart_field?: string;   // Ergebnis-Feld für den Verlaufs-Chart
  target_param?: string;  // Param-Key: Wunschpreis (<= gut)
  max_param?: string;     // Param-Key: Schmerzgrenze (> teuer)
  unit?: string;          // z.B. "€"
  secondary?: SecondaryField[];  // zusätzliche Felder als Chips
  trend_good?: 'up' | 'down';    // welche Richtung ist "gut" (bei Preisen: down)
}

export type Verdict = 'good' | 'ok' | 'high' | 'neutral';

export interface Resolved {
  headlineField?: string;
  chartField?: string;
  unit?: string;
  target: number | null;
  max: number | null;
  secondary: SecondaryField[];
  trendGood: 'up' | 'down';
}

// Zahl aus gemischten Strings ("£51.77", "1.234,50 €") robust parsen.
export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^0-9.,-]+/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
    return isFinite(n) ? n : null;
  }
  return null;
}

// display + Parameter (Projekt gemergt mit Agent) -> aufgelöste Anzeige-Config.
export function resolveDisplay(manifest: Manifest | undefined, params: Record<string, any> | null | undefined): Resolved {
  const d = (manifest?.display || {}) as DisplayConfig;
  const p = params || {};
  const num = (k?: string) => (k && p[k] != null && p[k] !== '' ? toNumber(p[k]) : null);
  return {
    headlineField: d.headline,
    chartField: d.chart_field || d.headline,
    unit: d.unit,
    target: num(d.target_param),
    max: num(d.max_param),
    secondary: Array.isArray(d.secondary) ? d.secondary : [],
    trendGood: d.trend_good === 'up' ? 'up' : 'down',
  };
}

// Trend der Kennzahl: neuester vs. vorheriger Ergebniswert.
export interface Trend { dir: 'up' | 'down' | 'flat'; deltaPct: number | null; good: boolean; }
export function trendOf(latest: number | null, previous: number | null, trendGood: 'up' | 'down'): Trend | null {
  if (latest == null || previous == null || previous === 0) return null;
  const diff = latest - previous;
  const dir: Trend['dir'] = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  if (dir === 'flat') return { dir, deltaPct: 0, good: true };
  return { dir, deltaPct: Math.abs(diff / previous) * 100, good: dir === trendGood };
}

// Kennzahl gegen Wunsch-/Schmerzgrenze bewerten.
export function verdictFor(value: number | null, r: Pick<Resolved, 'target' | 'max'>): Verdict {
  if (value == null) return 'neutral';
  if (r.target != null && value <= r.target) return 'good';
  if (r.max != null && value > r.max) return 'high';
  return 'ok';
}

export const VERDICT_STYLE: Record<Verdict, { text: string; badge: string; label: string }> = {
  good:    { text: 'text-emerald-400', badge: 'bg-emerald-500/15 text-emerald-300', label: 'Wunschpreis erreicht' },
  ok:      { text: 'text-white',       badge: 'bg-[#1f2937] text-[#9ca3af]',        label: 'im Rahmen' },
  high:    { text: 'text-red-400',     badge: 'bg-red-500/15 text-red-300',         label: 'über Schmerzgrenze' },
  neutral: { text: 'text-[#9ca3af]',   badge: 'bg-[#1f2937] text-[#9ca3af]',        label: '' },
};

// Kennzahl-Rohwert eines Ergebnisses gemäß Manifest herausziehen.
export function headlineValue(data: Record<string, any> | undefined, r: Resolved): { raw: any; num: number | null } {
  if (!data || !r.headlineField) return { raw: undefined, num: null };
  const raw = data[r.headlineField];
  return { raw, num: toNumber(raw) };
}
