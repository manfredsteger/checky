import type { Resolved } from '../lib/resultDisplay';
import { headlineValue, verdictFor, VERDICT_STYLE } from '../lib/resultDisplay';

// Zeigt die Manifest-Kennzahl eines Ergebnisses groß + farbig nach Wunsch-/
// Schmerzgrenze. size='sm' für die Agenten-Karte, 'lg' für die Ergebnisseite.
export function PriceHeadline({ data, resolved, size = 'sm' }: {
  data: Record<string, any> | undefined;
  resolved: Resolved;
  size?: 'sm' | 'lg';
}) {
  const { raw, num } = headlineValue(data, resolved);
  if (raw == null || raw === '') return null;

  const verdict = verdictFor(num, resolved);
  const style = VERDICT_STYLE[verdict];
  const showBadge = verdict !== 'neutral' && verdict !== 'ok' && style.label;

  return (
    <div className="flex items-baseline gap-2 flex-wrap">
      <span className={`${size === 'lg' ? 'text-3xl' : 'text-xl'} font-bold tabular-nums ${style.text}`}>
        {String(raw)}
      </span>
      {resolved.unit && num != null && !String(raw).includes(resolved.unit) && (
        <span className={`${size === 'lg' ? 'text-base' : 'text-xs'} text-[#6b7280]`}>{resolved.unit}</span>
      )}
      {showBadge && (
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${style.badge}`}>
          {style.label}
        </span>
      )}
      {resolved.target != null && (
        <span className="text-[10px] text-[#6b7280]">Ziel ≤ {resolved.target}{resolved.unit ? ` ${resolved.unit}` : ''}</span>
      )}
    </div>
  );
}
