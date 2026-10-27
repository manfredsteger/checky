import { PgBoss } from 'pg-boss';
import pg from 'pg';
import crypto from 'crypto';
import { executeRecipe, applyPlausibilityChecks } from './executor.js';
import { ClaudeAgentProvider } from './aiProvider.js';
import { runRecorderSession, runAssistedRecorderSession } from './recorder.js';
import { deriveParams } from './params.js';
import { searchKeyOf, searchParamsOf, canonicalJson, hashableView, enrichWithLibrary, isLibraryConfigured } from '@checky/shared';
import { enqueueNotification, processOutbox, runCleanup, checkRateLimit, getSettings } from './notify.js';
import { fetchProvider } from './providers/index.js';

const dbUrl = process.env.DB_URL;
// KI nur aktiv, wenn ein Abo-Token vorhanden ist (sonst kein Self-Healing -> Run failt sauber).
const aiProvider = process.env.CLAUDE_CODE_OAUTH_TOKEN ? new ClaudeAgentProvider() : undefined;
let pool: pg.Pool | null = null;
let boss: PgBoss | null = null;

if (dbUrl) {
  pool = new pg.Pool({ connectionString: dbUrl });
  // Ohne diesen Handler beendet eine abgebrochene LEERLAUF-Verbindung den
  // ganzen Prozess: node wirft bei einem 'error'-Event ohne Zuhörer. Genau so
  // ist der Worker still gestorben — und alle Läufe standen auf „wartet auf
  // Worker", ohne dass jemand sie abgearbeitet hätte.
  pool.on('error', (err: Error) => {
    console.error('[Worker] Datenbank-Verbindung verloren (wird neu aufgebaut):', err.message);
  });

  // Verwaiste Läufe aufräumen. Stirbt der Worker mitten in einem Lauf (Absturz,
  // Neustart, Deploy), bleibt dessen Zeile auf 'running' stehen — im Dashboard
  // dreht sich dann für immer ein Spinner. Beim Start gibt es keinen laufenden
  // Lauf, also sind alle 'running' von vorhin und werden ehrlich als
  // abgebrochen markiert.
  try {
    const orphans = await pool.query(
      `UPDATE runs SET status='failed', finished_at=NOW(),
              error=COALESCE(error, 'Abgebrochen: der Worker wurde neu gestartet (Absturz oder Deploy).')
       WHERE status IN ('running','queued') RETURNING id`);
    if (orphans.rowCount) console.log(`[Worker] ${orphans.rowCount} verwaiste Läufe aufgeräumt`);
  } catch (e) {
    console.error('[Worker] Aufräumen verwaister Läufe fehlgeschlagen:', e);
  }
  boss = new PgBoss(dbUrl);
  boss.on('error', (error: any) => console.error('[pg-boss error]', error));
}

async function start() {
  if (!dbUrl || !boss || !pool) {
    console.warn('[Worker] WARNUNG: DB_URL fehlt. Worker-Features sind deaktiviert.');
    // Am Leben bleiben, ohne abzustürzen
    setInterval(() => {}, 1000 * 60 * 60);
    return;
  }

  await boss.start();
  console.log('[Worker] pg-boss started');

  // Geteilte Sofort-Queue für manuelle Trigger: immer registriert, damit neue
  // Agenten NICHT bis zum nächsten 60s-Scheduler-Poll auf ihre eigene Queue
  // warten müssen. Cron läuft weiterhin über die per-Agent-Queues.
  await boss.createQueue('agent-run').catch(() => {});
  // Mehrere Läufe gleichzeitig. Ein Browser-Lauf dauert 30-90 s; wird nach einer
  // Parameteränderung ein ganzes Projekt neu vermessen, stehen sonst alle
  // Agenten minutenlang auf „wartet auf Worker". Der Deckel bleibt niedrig,
  // weil jeder Lauf ein eigenes Chromium startet (Arbeitsspeicher + CPU).
  // Diese Grenze gilt für ALLE Läufe: auch die Zeitplan-Läufe landen in
  // dieser einen Warteschlange (siehe updateSchedules).
  const CONCURRENCY = Math.max(1, Math.min(Number(process.env.RUN_CONCURRENCY ?? 3), 6));
  // Bewusst N EIGENSTÄNDIGE Arbeiter statt eines mit batchSize N: bei einem
  // Stapel holt pg-boss erst dann Nachschub, wenn der GANZE Stapel fertig ist —
  // ein langsamer Lauf (Lufthansa City Center braucht ~3 min) legt dann alle
  // anderen still. Eigene Arbeiter ziehen unabhängig voneinander nach.
  for (let i = 0; i < CONCURRENCY; i++) {
    await boss.work('agent-run', { batchSize: 1 }, async (jobs: any[]) => {
      for (const job of jobs) await handleJob(job);
    });
  }
  console.log(`[Worker] ${CONCURRENCY} Läufe gleichzeitig möglich`);

  // Recorder-Queue: Anlern-Sessions (langlaufend, bis 5 min)
  await boss.createQueue('recorder').catch(() => {});
  await boss.work('recorder', { batchSize: 1 }, async (jobs: any[]) => {
    for (const job of jobs) await handleRecorderJob(job);
  });

  // Cleanup-Queue: manueller Trigger + täglicher Cron.
  await boss.createQueue('cleanup').catch(() => {});
  await boss.work('cleanup', async (jobs: any[]) => {
    for (const _ of jobs) {
      const r = await runCleanup(pool!);
      console.log(`[Worker] Cleanup: ${r.deletedRuns} Läufe, ${r.deletedFiles} Screenshots gelöscht`);
    }
  });
  await boss.schedule('cleanup', '0 3 * * *', {}, { tz: 'UTC' }).catch(() => {});

  // Outbox-Processor: fällige Benachrichtigungen zustellen (alle 10s).
  setInterval(() => { processOutbox(pool!).catch(err => console.error('[Worker] Outbox-Fehler:', err)); }, 10000);

  // Früher hatte jeder Agent eine eigene Queue mit eigenem Arbeiter. Folge:
  // die Grenze oben galt nur für manuelle Läufe, zur vollen Stunde starteten
  // bis zu 9 Chromium gleichzeitig (Worker >1400 % CPU), und ~150 Queues
  // fragten die Datenbank alle 2 s ab. Jetzt hängen alle Zeitpläne an der
  // gemeinsamen Queue (je Agent ein Zeitplan-Schlüssel).
  await migrateLegacyQueues();
  await updateSchedules();
  // Agenten alle 60s neu abgleichen (neue/geänderte/deaktivierte Agenten)
  setInterval(updateSchedules, 60000);
}

const LEGACY_PREFIX = 'agent-run-';

// Einmalig (idempotent): alte Pro-Agent-Queues leeren und löschen. Noch
// wartende Jobs wandern in die gemeinsame Queue, damit kein geplanter Lauf
// verloren geht.
async function migrateLegacyQueues() {
  try {
    const { rows } = await pool!.query(
      `SELECT name FROM pgboss.queue WHERE name LIKE 'agent-run-%'`);
    if (!rows.length) return;
    let moved = 0;
    for (const { name } of rows) {
      await boss!.unschedule(name).catch(() => {});
      for (;;) {
        const jobs: any[] = (await boss!.fetch(name, { batchSize: 50 }).catch(() => [])) || [];
        if (!jobs.length) break;
        for (const job of jobs) {
          await boss!.send('agent-run', job.data, { retryLimit: 2, retryBackoff: true });
          await boss!.complete(name, job.id).catch(() => {});
          moved++;
        }
      }
      await boss!.deleteQueue(name).catch((e: any) =>
        console.warn(`[Worker] Alte Queue ${name} nicht gelöscht:`, e?.message || e));
    }
    console.log(`[Worker] ${rows.length} alte Pro-Agent-Queues aufgelöst, ${moved} wartende Jobs übernommen`);
  } catch (e) {
    console.error('[Worker] Umzug der alten Queues fehlgeschlagen:', e);
  }
}

async function updateSchedules() {
  try {
    const { rows: agents } = await pool!.query('SELECT id, name, enabled, schedule_cron FROM agents');
    const existing = new Map<string, string>();
    for (const s of await boss!.getSchedules('agent-run')) existing.set(s.key, s.cron);
    const currentEnabled = new Set<string>();

    for (const agent of agents) {
      if (!agent.enabled || !agent.schedule_cron) continue;
      currentEnabled.add(agent.id);
      // Nur schreiben, wenn neu oder geändert — sonst 75 Upserts pro Minute.
      if (existing.get(agent.id) === agent.schedule_cron) continue;
      try {
        await boss!.schedule('agent-run', agent.schedule_cron, { agent_id: agent.id, source: 'cron' }, {
          key: agent.id,
          retryLimit: 2,
          retryBackoff: true,
          tz: 'UTC',
        });
      } catch (e) {
        console.error(`[Worker] Konnte Agent ${agent.name} (${agent.id}) nicht planen:`, e);
      }
    }

    // Zeitpläne deaktivierter oder gelöschter Agenten entfernen
    for (const key of existing.keys()) {
      if (!currentEnabled.has(key)) await boss!.unschedule('agent-run', key);
    }
  } catch (error) {
    console.error('[Worker] Error updating schedules:', error);
  }
}

// Änderungs-Hash: kanonisches JSON (Schlüssel auf jeder Ebene sortiert),
// ohne Bibliotheksfelder — „geändert" heißt „die Quelle hat etwas Neues",
// nicht „die eigene Bibliothek hat sich bewegt". Vorher lief hier ein
// JSON.stringify mit Replacer-Array, das verschachtelte Schlüssel (z.B. die
// Item-Titel in Listen) stillschweigend aus dem Hash ließ.
function hashOf(data: Record<string, any>): string {
  return crypto.createHash('sha256').update(canonicalJson(hashableView(data))).digest('hex');
}

async function sendRunNotification(agent: any, run_id: string, status: string, changed: boolean, data: any, error?: string) {
  try {
    if (agent.notify && agent.notify.enabled === false) return; // pro Agent abschaltbar
    const { rows } = await pool!.query('SELECT name FROM projects WHERE id = $1', [agent.project_id]);
    const base = process.env.PUBLIC_URL || 'http://localhost:8081';
    await enqueueNotification(pool!, {
      agent: agent.name,
      agent_id: agent.id,
      project: rows[0]?.name || null,
      status,
      changed,
      data: data ?? null,
      error: error ?? null,
      run_id,
      link: `${base}/runs`,
    });
  } catch (e) {
    console.error('[Worker] Notify-Enqueue-Fehler:', e);
  }
}

async function handleJob(job: any) {
  const { agent_id, source = 'manual', run_id: existing_run_id } = job.data;

  // 1. Check Global Kill-Switch
  const { rows: settings } = await pool!.query('SELECT value FROM settings WHERE key = $1', ['paused']);
  if (settings.length > 0 && settings[0].value === true) {
    console.log(`[Worker] Global kill-switch active. Aborting job ${job.id}`);
    return;
  }

  // 2. Fetch agent
  const { rows: agents } = await pool!.query('SELECT * FROM agents WHERE id = $1', [agent_id]);
  if (agents.length === 0 || (!agents[0].enabled && source === 'cron')) {
    // If deleted or disabled (and it's a cron job), abort
    return;
  }
  const agent = agents[0];

  // Projekt-Params + Agent-Params zusammenführen (Agent überschreibt Projekt).
  try {
    const { rows: pr } = await pool!.query('SELECT params FROM projects WHERE id = $1', [agent.project_id]);
    agent.params = { ...(pr[0]?.params || {}), ...(agent.params || {}) };
  } catch { /* Fallback: nur Agent-Params */ }
  // Fingerabdruck der Suche VOR der Ableitung bilden: abgeleitete Werte sind
  // reine Funktionen der Originale, und so kann die API denselben Schlüssel
  // berechnen, ohne die Ableitungslogik zu kennen.
  const searchKey = searchKeyOf(agent.params);
  const searchParams = searchParamsOf(agent.params);
  agent.params = deriveParams(agent.params);

  // 3. Jitter für Zeitplan-Läufe: Job später neu einstellen statt hier zu
  // schlafen — ein schlafender Job würde einen der wenigen Lauf-Plätze
  // bis zu jitter_min Minuten blockieren.
  if (source === 'cron' && agent.jitter_min > 0 && !job.data.jittered) {
    const jitterS = Math.floor(Math.random() * agent.jitter_min * 60);
    console.log(`[Worker] Jitter for agent ${agent.name}: startet in ${jitterS}s`);
    await boss!.send('agent-run', { ...job.data, jittered: true },
      { startAfter: jitterS, retryLimit: 2, retryBackoff: true });
    return;
  }

  // 4. Create or Update Run
  let run_id = existing_run_id;
  if (!run_id) {
    const { rows: runs } = await pool!.query(
      `INSERT INTO runs (agent_id, status) VALUES ($1, 'queued') RETURNING id`,
      [agent_id]
    );
    run_id = runs[0].id;
  }
  
  await pool!.query(`UPDATE runs SET status = 'running', started_at = NOW() WHERE id = $1`, [run_id]);

  console.log(`[Worker] Started run ${run_id} for agent ${agent.name} (Source: ${source})`);

  // Rate-Limit: max. N Läufe pro Tag pro Domain.
  const rl = await checkRateLimit(pool!, agent.site, run_id);
  if (rl.limited) {
    console.log(`[Worker] Run ${run_id} rate_limited (${rl.count}/${rl.limit} für ${agent.site})`);
    await pool!.query(`UPDATE runs SET status='failed', finished_at=NOW(), error='rate_limited' WHERE id=$1`, [run_id]);
    return;
  }

  try {
    // 4b. API-Quelle (kind:api): Provider-Adapter statt Recipe/Browser.
    if (agent.provider) {
      const { sources } = await getSettings(pool!);
      const resultData = await fetchProvider(agent.provider, agent.params || {}, { sources });
      // Dieselbe Plausibilitätsprüfung wie bei Browser-Recipes — ein
      // Provider-Ergebnis (z.B. Kiwi) ist sonst von der Direktflug-/
      // Schmerzgrenze-Prüfung ausgenommen, nur weil es keinen Playwright-Lauf
      // durchläuft.
      applyPlausibilityChecks(resultData, agent.params);
      // Bibliotheks-Abgleich (Jellyfin/Emby/Plex): markiert Einträge, die
      // schon in der eigenen Sammlung liegen bzw. wie viele Folgen fehlen.
      // Wirft nie — Fehler landen als library_error im Ergebnis.
      if (isLibraryConfigured(sources.media_library)) {
        await enrichWithLibrary(resultData, sources.media_library);
        if (resultData.library_error) console.warn(`[Worker] Run ${run_id}: Bibliotheks-Abgleich fehlgeschlagen — ${resultData.library_error}`);
      }
      const data_hash = hashOf(resultData);
      const { rows: last } = await pool!.query(
        `SELECT data_hash FROM results WHERE agent_id = $1 AND search_key IS NOT DISTINCT FROM $2
         ORDER BY created_at DESC LIMIT 1`, [agent_id, searchKey]);
      const changed = last.length === 0 || last[0].data_hash !== data_hash;
      await pool!.query(
        `INSERT INTO results (run_id, agent_id, data, data_hash, changed, search_key, search_params)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [run_id, agent_id, JSON.stringify(resultData), data_hash, changed, searchKey, JSON.stringify(searchParams)]);
      await pool!.query(`UPDATE runs SET status='succeeded', finished_at=NOW() WHERE id=$1`, [run_id]);
      console.log(`[Worker] Run ${run_id} succeeded via provider "${agent.provider}". Changed: ${changed}`);
      if (changed) await sendRunNotification(agent, run_id, 'succeeded', true, resultData);
      return;
    }

    // 5. Fetch Recipe
    const { rows: recipes } = await pool!.query('SELECT * FROM recipes WHERE agent_id = $1 ORDER BY version DESC LIMIT 1', [agent_id]);
    
    if (recipes.length === 0) {
      throw new Error('No recipe found for agent');
    }
    const recipe = recipes[0];

    // Update run with recipe_id
    await pool!.query(`UPDATE runs SET recipe_id = $1 WHERE id = $2`, [recipe.id, run_id]);

    // 6. Playwright Executor (mit optionalem KI-Provider für Self-Healing/ai_json)
    const runResult = await executeRecipe(agent, recipe, run_id, aiProvider);

    if (runResult.error) {
      console.error(`[Worker] Executor failed for run ${run_id}:`, runResult.error);
      await pool!.query(`UPDATE runs SET status = 'failed', finished_at = NOW(), error = $1, steps_log = $2, screenshot_before = $3, screenshot_after = $4, ai_tokens = $5 WHERE id = $6`,
        [runResult.error, JSON.stringify(runResult.stepsLog), runResult.screenshotBefore, runResult.screenshotAfter, runResult.aiTokens || 0, run_id]
      );
      await sendRunNotification(agent, run_id, 'failed', false, null, runResult.error);
      return; // End here but do not throw to pg-boss, or throw if we want retry?
      // If we want retry, we should throw. But we want to record the screenshots and logs.
      // throw new Error(runResult.error);
    }

    const data_hash = hashOf(runResult.resultData);

    // 7. Check changed flag
    const { rows: lastResults } = await pool!.query(
      `SELECT data_hash FROM results WHERE agent_id = $1 AND search_key IS NOT DISTINCT FROM $2
       ORDER BY created_at DESC LIMIT 1`,
      [agent_id, searchKey]
    );
    const changed = lastResults.length === 0 || lastResults[0].data_hash !== data_hash;

    // 8. Save Result
    await pool!.query(
      `INSERT INTO results (run_id, agent_id, data, data_hash, changed, search_key, search_params)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [run_id, agent_id, JSON.stringify(runResult.resultData), data_hash, changed, searchKey, JSON.stringify(searchParams)]
    );

    // 9. Self-Healing: bei repariertem Selektor neue Recipe-Version speichern
    let finalStatus: 'succeeded' | 'healed' = 'succeeded';
    if (runResult.healed && runResult.newSteps) {
      const { rows: vRows } = await pool!.query(
        'SELECT COALESCE(MAX(version), 0) + 1 AS next FROM recipes WHERE agent_id = $1', [agent_id]
      );
      await pool!.query(
        'INSERT INTO recipes (agent_id, version, steps, healed_from) VALUES ($1, $2, $3, $4)',
        [agent_id, vRows[0].next, JSON.stringify(runResult.newSteps), recipe.id]
      );
      finalStatus = 'healed';
      console.log(`[Worker] Run ${run_id} healed -> neue Recipe-Version v${vRows[0].next} (healed_from ${recipe.id})`);
    }

    // 10. Update run
    await pool!.query(`UPDATE runs SET status = $1, finished_at = NOW(), steps_log = $2, screenshot_before = $3, screenshot_after = $4, ai_tokens = $5 WHERE id = $6`,
      [finalStatus, JSON.stringify(runResult.stepsLog), runResult.screenshotBefore, runResult.screenshotAfter, runResult.aiTokens || 0, run_id]
    );
    console.log(`[Worker] Run ${run_id} ${finalStatus}. Changed: ${changed}. AI-Tokens: ${runResult.aiTokens || 0}`);

    // Benachrichtigung nur bei Änderung.
    if (changed) await sendRunNotification(agent, run_id, finalStatus, true, runResult.resultData);

  } catch (error) {
    console.error(`[Worker] Run ${run_id} failed:`, error);
    await pool!.query(`UPDATE runs SET status = 'failed', finished_at = NOW(), error = $1 WHERE id = $2`, [String(error), run_id]);
    await sendRunNotification(agent, run_id, 'failed', false, null, String(error));
    throw error; // Rethrow to let pg-boss handle retries
  }
}

async function handleRecorderJob(job: any) {
  const { session_id } = job.data;
  const { rows } = await pool!.query('SELECT * FROM recorder_sessions WHERE id = $1', [session_id]);
  if (rows.length === 0) return;
  const session = rows[0];
  if (session.status !== 'running') return; // bereits abgebrochen/fertig

  const { rows: agents } = await pool!.query('SELECT * FROM agents WHERE id = $1', [session.agent_id]);
  if (agents.length === 0) {
    await pool!.query(`UPDATE recorder_sessions SET status='failed', error='Agent nicht gefunden' WHERE id=$1`, [session_id]);
    return;
  }

  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    await pool!.query(`UPDATE recorder_sessions SET status='failed', error='Kein CLAUDE_CODE_OAUTH_TOKEN gesetzt' WHERE id=$1`, [session_id]);
    return;
  }

  // Projekt-Params + Agent-Params zusammenführen und {{Platzhalter}} im Ziel
  // auflösen — sonst liest der Anlern-Agent wörtlich „Flug {{origin}}→{{dest}}"
  // und weiß weder Route noch Datum. (Der Ausführungspfad tat das längst.)
  const agent = agents[0];
  try {
    const { rows: pr } = await pool!.query('SELECT params FROM projects WHERE id = $1', [agent.project_id]);
    agent.params = { ...(pr[0]?.params || {}), ...(agent.params || {}) };
  } catch { /* Fallback: nur Agent-Params */ }
  agent.params = deriveParams(agent.params);
  agent.goal_text = String(agent.goal_text || '').replace(
    /\{\{(.*?)\}\}/g,
    (m: string, k: string) => (agent.params?.[k.trim()] !== undefined ? String(agent.params[k.trim()]) : m),
  );

  const mode = session.mode === 'assisted' ? 'assisted' : 'auto';
  console.log(`[Worker] Recorder-Session ${session_id} (${mode}) für Agent ${agent.name} gestartet`);
  if (mode === 'assisted') {
    await runAssistedRecorderSession(session_id, agent, pool!);
  } else {
    await runRecorderSession(session_id, agent, pool!);
  }
  console.log(`[Worker] Recorder-Session ${session_id} beendet`);
}

start().catch(err => {
  console.error('Failed to start worker:', err);
  process.exit(1);
});
