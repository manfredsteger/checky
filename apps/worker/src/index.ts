import { PgBoss } from 'pg-boss';
import pg from 'pg';
import crypto from 'crypto';
import { executeRecipe } from './executor.js';
import { ClaudeAgentProvider } from './aiProvider.js';
import { runRecorderSession } from './recorder.js';
import { enqueueNotification, processOutbox, runCleanup, checkRateLimit } from './notify.js';

const dbUrl = process.env.DB_URL;
// KI nur aktiv, wenn ein Abo-Token vorhanden ist (sonst kein Self-Healing -> Run failt sauber).
const aiProvider = process.env.CLAUDE_CODE_OAUTH_TOKEN ? new ClaudeAgentProvider() : undefined;
let pool: pg.Pool | null = null;
let boss: PgBoss | null = null;

if (dbUrl) {
  pool = new pg.Pool({ connectionString: dbUrl });
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

  // pg-boss v12: Queues müssen existieren, Wildcard-work gibt es nicht.
  // -> Pro Agent eine Queue mit eigenem Worker, registriert in updateSchedules().
  await updateSchedules();
  // Agenten alle 60s neu abgleichen (neue/geänderte/deaktivierte Agenten)
  setInterval(updateSchedules, 60000);
}

// Queues, für die bereits ein Worker registriert wurde
const workingQueues = new Set<string>();

async function ensureQueueWorker(queueName: string) {
  if (workingQueues.has(queueName)) return;
  try {
    await boss!.createQueue(queueName);
  } catch {
    // Queue existiert bereits -> ok
  }
  await boss!.work(queueName, { batchSize: 1 }, async (jobs: any[]) => {
    for (const job of jobs) await handleJob(job);
  });
  workingQueues.add(queueName);
}

async function updateSchedules() {
  try {
    const { rows: agents } = await pool!.query('SELECT * FROM agents');
    const currentEnabled = new Set<string>();

    for (const agent of agents) {
      if (agent.enabled) {
        currentEnabled.add(agent.id);
        const queueName = `agent-run-${agent.id}`;
        try {
          await ensureQueueWorker(queueName);
          await boss!.schedule(queueName, agent.schedule_cron, { agent_id: agent.id, source: 'cron' }, {
            retryLimit: 2,
            retryBackoff: true,
            tz: 'UTC' // Optional timezone handling
          });
        } catch (e) {
          console.error(`[Worker] Konnte Agent ${agent.name} (${agent.id}) nicht planen:`, e);
        }
      }
    }

    // Unschedule disabled or deleted agents
    const { rows: schedules } = await pool!.query('SELECT name FROM pgboss.schedule');
    for (const row of schedules) {
      if (row.name.startsWith('agent-run-')) {
        const agentId = row.name.slice('agent-run-'.length);
        if (!currentEnabled.has(agentId)) {
          await boss!.unschedule(row.name);
        }
      }
    }
  } catch (error) {
    console.error('[Worker] Error updating schedules:', error);
  }
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

  // 3. Jitter for cron jobs
  if (source === 'cron' && agent.jitter_min > 0) {
    const jitterMs = Math.floor(Math.random() * agent.jitter_min * 60 * 1000);
    console.log(`[Worker] Jitter for agent ${agent.name}: waiting ${jitterMs}ms`);
    await new Promise(resolve => setTimeout(resolve, jitterMs));
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

    // Canonicalize JSON and hash
    const canonicalStr = JSON.stringify(runResult.resultData, Object.keys(runResult.resultData).sort());
    const data_hash = crypto.createHash('sha256').update(canonicalStr).digest('hex');

    // 7. Check changed flag
    const { rows: lastResults } = await pool!.query(
      `SELECT data_hash FROM results WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [agent_id]
    );
    const changed = lastResults.length === 0 || lastResults[0].data_hash !== data_hash;

    // 8. Save Result
    await pool!.query(
      `INSERT INTO results (run_id, agent_id, data, data_hash, changed) VALUES ($1, $2, $3, $4, $5)`,
      [run_id, agent_id, JSON.stringify(runResult.resultData), data_hash, changed]
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

  console.log(`[Worker] Recorder-Session ${session_id} für Agent ${agents[0].name} gestartet`);
  await runRecorderSession(session_id, agents[0], pool!);
  console.log(`[Worker] Recorder-Session ${session_id} beendet`);
}

start().catch(err => {
  console.error('Failed to start worker:', err);
  process.exit(1);
});
