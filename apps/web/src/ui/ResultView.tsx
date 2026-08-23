import type { Result } from '@checky/shared';
import type { Resolved } from '../lib/resultDisplay';
import { headlineValue, verdictFor, VERDICT_STYLE, toNumber, trendOf } from '../lib/resultDisplay';

// Sonderformatierung für bekannte Felder (schöner als key:value).
function fmt(field: string, value: any): string {
  if (value == null || value === '') return '—';
  if (field === 'stops') {
    // Quellen liefern hier mal eine Zahl (0/1/2), mal Text ("1 Stopp", "Direkt").
    // Nur bei einer echten Zahl selbst formatieren, sonst den Text durchreichen —
    // Number("1 Stopp") wäre NaN und stand vorher so auf der Karte.
    const n = typeof value === 'number' ? value : Number(String(value).trim());
    if (Number.isFinite(n)) return n === 0 ? 'Direktflug' : `${n} Stopp${n > 1 ? 's' : ''}`;
    return String(value);
  }
  return String(value);
}

const ArrowIcon = ({ dir }: { dir: 'up' | 'down' | 'flat' }) =>
  dir === 'up' ? <>▲</> : dir === 'down' ? <>▼</> : <>→</>;

// Manifest-getriebene Ergebnis-Ansicht: Kennzahl groß + farbig, Trendpfeil
// (vs. Vorlauf), plus die im Manifest definierten Sekundär-Felder als Chips.
export function ResultView({ results, resolved, size = 'sm' }: {
  results: Result[] | undefined;
  resolved: Resolved;
  size?: 'sm' | 'lg';
}) {
  const last = results?.[0];
  const prev = results?.[1];
  if (!last || !resolved.headlineField) return null;
  const { raw, num } = headlineValue(last.data, resolved);
  if (raw == null || raw === '') return null;

  const verdict = verdictFor(num, resolved);
  const style = VERDICT_STYLE[verdict];
  const showVerdict = verdict === 'good' || verdict === 'high';

  const prevNum = prev ? headlineValue(prev.data, resolved).num : null;
  const trend = trendOf(num, prevNum, resolved.trendGood);

  const chips = resolved.secondary
    .map(s => ({ ...s, value: last.data?.[s.field] }))
    .filter(s => s.value != null && s.value !== '');

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className={`${size === 'lg' ? 'text-3xl' : 'text-xl'} font-bold tabular-nums ${style.text}`}>{String(raw)}</span>
        {resolved.unit && num != null && !String(raw).includes(resolved.unit) && (
          <span className={`${size === 'lg' ? 'text-base' : 'text-xs'} text-[#6b7280]`}>{resolved.unit}</span>
        )}
        {trend && trend.dir !== 'flat' && (
          <span className={`text-xs font-semibold inline-flex items-center gap-0.5 ${trend.good ? 'text-emerald-400' : 'text-red-400'}`}
            title="Veränderung zum vorherigen Lauf">
            <ArrowIcon dir={trend.dir} />{trend.deltaPct != null ? ` ${trend.deltaPct.toFixed(1)}%` : ''}
          </span>
        )}
        {(last.data as any)?._ai && (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-300"
            title="Der Selektor griff nicht — dieser Wert wurde von der KI aus dem Seitentext geschätzt und kann falsch sein. Recipe prüfen.">
            geschätzt
          </span>
        )}
        {showVerdict && style.label && (
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${style.badge}`}>{style.label}</span>
        )}
      </div>

      {resolved.target != null && (
        <span className="text-[10px] text-[#6b7280] -mt-1">Ziel ≤ {resolved.target}{resolved.unit ? ` ${resolved.unit}` : ''}</span>
      )}

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chips.map(c => (
            <span key={c.field} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#0a0a0b] border border-[#1f2937] text-[11px]">
              {c.label && <span className="text-[#6b7280]">{c.label}</span>}
              <span className="text-[#d1d5db] font-medium">{fmt(c.field, c.value)}{c.suffix || ''}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
