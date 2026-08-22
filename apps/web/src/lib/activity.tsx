import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { ActiveRun, RecentRun } from '@checky/shared';

/**
 * Live-Aktivität der ganzen App an einer Stelle: pollt /api/activity und stellt
 * je Agent/Projekt bereit, ob dort gerade etwas wartet oder läuft. Solange etwas
 * aktiv ist, wird schnell gepollt (1.5s), sonst gemächlich (5s).
 *
 * Drei Quellen, damit man jeden Lauf sieht — auch die ganz kurzen:
 *  1. Server: Läufe in „queued"/„running" (Browser-Recipes dauern Sekunden bis Minuten).
 *  2. Optimistisch: ab dem Klick auf „Ausführen" sofort, unabhängig vom Poll-Takt.
 *  3. Quittung: gerade beendete Läufe — API-Quellen sind teils in 150ms durch,
 *     davon würde ein reiner Spinner nie etwas zeigen.
 *
 * Verschwindet ein Lauf (= fertig), werden die Ergebnis-Queries des Agenten
 * invalidiert — die Kacheln aktualisieren sich also von selbst.
 */

/** Wie lange ein Klick allein die Karte „aktiv" hält, bevor der Server übernimmt. */
const OPTIMISTIC_MS = 1500;
/** Wie lange die Erfolgs-/Fehler-Quittung nach dem Lauf stehen bleibt. */
const OUTCOME_MS = 12000;
/** Ab wann ein Lauf als „hängt vermutlich" gilt (ohne bekannte Erwartungsdauer). */
const STALL_AFTER_SEC = 300;

export interface AgentActivity {
  status: 'queued' | 'running';
  runId: string | null;
  /** Sekunden seit Start (bzw. seit Einreihung, solange „queued"). */
  elapsed: number;
  /** 0..1 — nur gesetzt, wenn eine Erwartungsdauer aus früheren Läufen bekannt ist. */
  progress: number | null;
  /** Erwartete Restdauer in Sekunden (nur mit bekannter Erwartungsdauer). */
  remaining: number | null;
  /** Läuft ungewöhnlich lange (> 3× Erwartung bzw. > 5 Min) — evtl. hängt der Worker. */
  stalled: boolean;
}

export interface AgentOutcome {
  status: 'succeeded' | 'failed' | 'healed';
  error: string | null;
  /** Sekunden seit Ende des Laufs. */
  ago: number;
}

interface ActivityValue {
  runs: ActiveRun[];
  recent: RecentRun[];
  eta: Record<string, number>;
  /** Klickzeitpunkte je Agent für das optimistische Sofort-Feedback. */
  pending: Record<string, number>;
  /** Meldet einen gerade ausgelösten Lauf — zeigt die Karte sofort als aktiv. */
  markPending: (agentId: string) => void;
  /** Sekunden-Ticker, damit Zeiten/Balken flüssig hochlaufen. */
  now: number;
  /** Uhr-Versatz Browser ↔ Server in ms (verhindert negative Laufzeiten). */
  skew: number;
}

const Ctx = createContext<ActivityValue>({
  runs: [], recent: [], eta: {}, pending: {}, markPending: () => {}, now: Date.now(), skew: 0,
});

export function ActivityProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [now, setNow] = useState(() => Date.now());
  const [pending, setPending] = useState<Record<string, number>>({});
  const skewRef = useRef(0);
  const prevAgents = useRef<Set<string>>(new Set());

  const { data } = useQuery({
    queryKey: ['activity'],
    queryFn: api.getActivity,
    // Schnell pollen, solange etwas aktiv ist; im Leerlauf sparsam.
    refetchInterval: (q) => {
      const d = q.state.data;
      if ((d?.runs.length ?? 0) > 0) return 1500;
      return (d?.recent.length ?? 0) > 0 ? 3000 : 5000;
    },
    refetchIntervalInBackground: false,
    retry: false,
  });

  const runs = data?.runs ?? [];
  const recent = data?.recent ?? [];
  const eta = data?.eta ?? {};

  // Uhr-Versatz mitführen: der Server liefert Zeitstempel, der Browser rechnet.
  useEffect(() => {
    if (data?.server_time) skewRef.current = Date.now() - new Date(data.server_time).getTime();
  }, [data?.server_time]);

  const markPending = useCallback((agentId: string) => {
    setPending(p => ({ ...p, [agentId]: Date.now() }));
  }, []);

  // Sekunden-Ticker nur, wenn wirklich etwas anzuzeigen ist.
  const ticking = runs.length > 0 || recent.length > 0 || Object.keys(pending).length > 0;
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);

  // Abgelaufene optimistische Marker wieder aufräumen.
  useEffect(() => {
    const stale = Object.entries(pending).filter(([, t]) => now - t > OPTIMISTIC_MS).map(([id]) => id);
    if (stale.length === 0) return;
    setPending(p => {
      const next = { ...p };
      for (const id of stale) delete next[id];
      return next;
    });
  }, [now, pending]);

  // Fertig gewordene Läufe → Ergebnisse des Agenten neu laden.
  useEffect(() => {
    const current = new Set(runs.map(r => r.agent_id));
    const finished = [...prevAgents.current].filter(id => !current.has(id));
    if (finished.length > 0) {
      for (const id of finished) {
        qc.invalidateQueries({ queryKey: ['agent-last', id] });
        qc.invalidateQueries({ queryKey: ['agent-results', id] });
      }
      qc.invalidateQueries({ queryKey: ['runs'] });
    }
    prevAgents.current = current;
  }, [runs, qc]);

  // Auch für ganz kurze Läufe (nie als „running" gesehen) die Ergebnisse nachladen.
  const recentKey = recent.map(r => r.run_id).join(',');
  useEffect(() => {
    if (!recentKey) return;
    for (const id of new Set(recent.map(r => r.agent_id))) {
      qc.invalidateQueries({ queryKey: ['agent-last', id] });
      qc.invalidateQueries({ queryKey: ['agent-results', id] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentKey, qc]);

  return (
    <Ctx.Provider value={{ runs, recent, eta, pending, markPending, now, skew: skewRef.current }}>
      {children}
    </Ctx.Provider>
  );
}

export function useActivity() { return useContext(Ctx); }

/** Aktivität eines einzelnen Agenten (oder null, wenn dort nichts läuft). */
export function useAgentActivity(agentId: string): AgentActivity | null {
  const { runs, eta, pending, now, skew } = useActivity();
  const run = runs.find(r => r.agent_id === agentId);

  if (!run) {
    // Noch kein Server-Echo: der Klick allein hält die Karte kurz aktiv.
    const clicked = pending[agentId];
    if (clicked && now - clicked < OPTIMISTIC_MS) {
      return { status: 'queued', runId: null, elapsed: (now - clicked) / 1000, progress: null, remaining: null, stalled: false };
    }
    return null;
  }

  const since = new Date(run.started_at ?? run.created_at).getTime() + skew;
  const elapsed = Math.max(0, (now - since) / 1000);
  const expected = eta[agentId];
  // Beim Warten in der Queue gibt es keinen sinnvollen Fortschritt.
  const hasEta = run.status === 'running' && Number.isFinite(expected) && expected > 1;
  // Bei 95 % deckeln: der Balken darf nie „voll" stehen, solange es noch läuft.
  const progress = hasEta ? Math.min(0.95, elapsed / expected) : null;

  return {
    status: run.status,
    runId: run.run_id,
    elapsed,
    progress,
    remaining: hasEta ? Math.max(0, expected - elapsed) : null,
    stalled: elapsed > (hasEta ? Math.max(STALL_AFTER_SEC, expected * 3) : STALL_AFTER_SEC),
  };
}

/** Quittung eines gerade beendeten Laufs (oder null). */
export function useAgentOutcome(agentId: string): AgentOutcome | null {
  const { recent, now, skew } = useActivity();
  const run = recent.find(r => r.agent_id === agentId);
  if (!run) return null;
  const ago = (now - (new Date(run.finished_at).getTime() + skew)) / 1000;
  if (ago * 1000 > OUTCOME_MS) return null;
  return { status: run.status, error: run.error, ago: Math.max(0, ago) };
}

/** Aktivität eines Projekts: wie viele Agenten laufen bzw. warten gerade? */
export function useProjectActivity(projectId: string) {
  const { runs, recent, pending, now } = useActivity();
  const mine = runs.filter(r => r.project_id === projectId);
  const running = mine.filter(r => r.status === 'running').length;
  const queued = mine.filter(r => r.status === 'queued').length;

  // Optimistisch: gerade angestoßene Agenten, die der Server noch nicht meldet.
  const known = new Set(mine.map(r => r.agent_id));
  const optimistic = Object.entries(pending)
    .filter(([id, t]) => now - t < OPTIMISTIC_MS && !known.has(id)).length;

  const done = recent.filter(r => r.project_id === projectId);
  const failed = done.filter(r => r.status === 'failed').length;

  return {
    running,
    queued: queued + optimistic,
    total: mine.length + optimistic,
    active: mine.length + optimistic > 0,
    justFinished: done.length,
    justFailed: failed,
  };
}

/** Laufzeit als m:ss. */
export function formatElapsed(sec: number): string {
  const s = Math.floor(sec % 60);
  return `${Math.floor(sec / 60)}:${String(s).padStart(2, '0')}`;
}
