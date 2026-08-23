import { query } from '../db.js';
import { enqueue } from './boss.js';
import { searchKeyOf, describeSearchDiff } from '@checky/shared';

export interface RequeueInfo {
  /** true, wenn sich die Suche selbst geändert hat (nicht nur eine Anzeige-Schwelle) */
  searchChanged: boolean;
  /** wie viele Läufe angestoßen wurden */
  requeued: number;
  /** lesbare Beschreibung der Änderung, z.B. ["children: 2 → 1"] */
  diff: string[];
}

/**
 * Nach einer Parameteränderung neu messen.
 *
 * Warum überhaupt: ändert man Route, Datum oder Reisendenzahl, misst jeder
 * Agent ab da etwas anderes. Bis zum nächsten Zeitplan-Lauf stünden im
 * Dashboard weiter die alten Zahlen — zur neuen Suche, aber mit Werten der
 * alten. Deshalb sofort einen Lauf je betroffenem Agenten einreihen.
 *
 * Reine Anzeige-Schwellen (Wunschpreis, Schmerzgrenze) lösen bewusst NICHTS
 * aus: daran ändert sich nur die Einfärbung, nicht der gemessene Wert.
 */
export async function requeueAfterParamChange(
  projectId: string,
  beforeProjectParams: Record<string, any>,
  afterProjectParams: Record<string, any>,
): Promise<RequeueInfo> {
  const agents = await query(
    'SELECT id, params, enabled FROM agents WHERE project_id = $1', [projectId]);

  let requeued = 0;
  let searchChanged = false;
  const diffs = new Set<string>();

  for (const a of agents.rows) {
    // Agent-Params überschreiben Projekt-Params — genau wie beim Ausführen.
    const before = { ...beforeProjectParams, ...(a.params || {}) };
    const after = { ...afterProjectParams, ...(a.params || {}) };
    if (searchKeyOf(before) === searchKeyOf(after)) continue;

    searchChanged = true;
    for (const d of describeSearchDiff(before, after)) diffs.add(d);
    if (!a.enabled) continue;   // pausierte Agenten nicht wecken

    const run = await query(
      `INSERT INTO runs (agent_id, status) VALUES ($1, 'queued') RETURNING id`, [a.id]);
    await enqueue('agent-run', { agent_id: a.id, run_id: run.rows[0].id, source: 'params-change' });
    requeued++;
  }

  return { searchChanged, requeued, diff: [...diffs] };
}
