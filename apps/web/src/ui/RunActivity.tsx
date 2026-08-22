import { Loader2, CheckCircle2, XCircle, Wrench } from 'lucide-react';
import { formatElapsed, type AgentActivity, type AgentOutcome } from '../lib/activity';

/**
 * Anzeige-Bausteine für „hier läuft gerade etwas": ein Fortschrittsbalken
 * (bestimmt, sobald eine Erwartungsdauer aus früheren Läufen bekannt ist —
 * sonst ein wanderndes Band) und ein kompaktes Status-Chip.
 */

const TONE = {
  queued:  { bar: 'bg-sky-400',     text: 'text-sky-300',     track: 'bg-sky-500/15' },
  running: { bar: 'bg-emerald-400', text: 'text-emerald-300', track: 'bg-emerald-500/15' },
  stalled: { bar: 'bg-amber-400',   text: 'text-amber-300',   track: 'bg-amber-500/15' },
} as const;

function toneOf(a: AgentActivity) {
  return a.stalled ? TONE.stalled : TONE[a.status];
}

/** Dünner Balken — als Kopfzeile einer Karte gedacht. */
export function RunProgressBar({ activity, className = '' }: { activity: AgentActivity; className?: string }) {
  const tone = toneOf(activity);
  return (
    <div className={`h-1 w-full overflow-hidden rounded-full ${tone.track} ${className}`}
         role="progressbar" aria-label="Lauf-Fortschritt"
         aria-valuenow={activity.progress != null ? Math.round(activity.progress * 100) : undefined}>
      {activity.progress != null ? (
        <div className={`h-full ${tone.bar} rounded-full transition-[width] duration-1000 ease-linear`}
             style={{ width: `${Math.round(activity.progress * 100)}%` }} />
      ) : (
        <div className={`h-full w-1/3 rounded-full checky-indeterminate ${tone.bar}`} />
      )}
    </div>
  );
}

/** Status-Chip mit Spinner und Laufzeit. */
export function RunStatusChip({ activity, className = '' }: { activity: AgentActivity; className?: string }) {
  const tone = toneOf(activity);
  const label = activity.stalled
    ? `Läuft ungewöhnlich lange · ${formatElapsed(activity.elapsed)}`
    : activity.status === 'queued'
      ? `In Warteschlange · ${formatElapsed(activity.elapsed)}`
      : activity.remaining != null
        ? `Läuft · ${formatElapsed(activity.elapsed)} · noch ca. ${formatElapsed(activity.remaining)}`
        : `Läuft · ${formatElapsed(activity.elapsed)}`;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tone.track} ${tone.text} ${className}`}>
      <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
      {label}
    </span>
  );
}

/** Pulsierender Punkt für kompakte Stellen (Sidebar, Kachel-Ecke). */
export function RunDot({ tone = 'running', title, className = '' }: { tone?: 'running' | 'queued'; title?: string; className?: string }) {
  const color = tone === 'queued' ? 'bg-sky-400' : 'bg-emerald-400';
  return (
    <span className={`relative inline-flex h-2 w-2 shrink-0 ${className}`} title={title}>
      <span className={`absolute inline-flex h-full w-full rounded-full opacity-70 animate-ping ${color}`} />
      <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
    </span>
  );
}

/**
 * Quittung direkt nach einem Lauf. API-Quellen sind oft in Millisekunden fertig —
 * ohne diesen kurzen Hinweis bliebe völlig unklar, dass überhaupt etwas passiert ist.
 */
export function RunOutcomeChip({ outcome, className = '' }: { outcome: AgentOutcome; className?: string }) {
  const ago = outcome.ago < 5 ? 'gerade eben' : `vor ${Math.round(outcome.ago)}s`;
  const look = outcome.status === 'failed'
    ? { cls: 'bg-red-500/15 text-red-300', icon: <XCircle className="w-3 h-3" aria-hidden />, label: `Fehlgeschlagen · ${ago}` }
    : outcome.status === 'healed'
      ? { cls: 'bg-amber-500/15 text-amber-300', icon: <Wrench className="w-3 h-3" aria-hidden />, label: `Geheilt · ${ago}` }
      : { cls: 'bg-emerald-500/15 text-emerald-300', icon: <CheckCircle2 className="w-3 h-3" aria-hidden />, label: `Aktualisiert · ${ago}` };

  return (
    <span title={outcome.error ?? undefined}
      className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${look.cls} ${className}`}>
      {look.icon}{look.label}
    </span>
  );
}
