import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { CreateProjectSchema, UpdateProjectSchema, CreateAgentSchema, UpdateAgentSchema, UpdateSettingsSchema } from '@checky/shared';
import { query } from './db.js';
// @ts-ignore
import { PgBoss } from 'pg-boss';

const dbUrl = process.env.DB_URL;
let boss: PgBoss | null = null;

if (dbUrl) {
  boss = new PgBoss(dbUrl);
  boss.on('error', (error: any) => console.error('[API pg-boss error]', error));
  boss.start().catch(console.error);
} else {
  console.warn('[API] WARNUNG: DB_URL fehlt. PgBoss deaktiviert.');
}

export const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'checky-api', timestamp: new Date().toISOString() });
});

const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

const IdParamSchema = z.object({ id: z.string().uuid() });
const PaginationSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });

// Projects
app.get('/api/projects', asyncHandler(async (req, res) => {
  const result = await query('SELECT * FROM projects ORDER BY created_at DESC');
  res.json(result.rows);
}));

app.post('/api/projects', asyncHandler(async (req, res) => {
  const data = CreateProjectSchema.parse(req.body);
  const result = await query(
    'INSERT INTO projects (name, description) VALUES ($1, $2) RETURNING *',
    [data.name, data.description || null]
  );
  res.status(201).json(result.rows[0]);
}));

app.get('/api/projects/:id', asyncHandler(async (req, res) => {
  const { id } = IdParamSchema.parse(req.params);
  const result = await query('SELECT * FROM projects WHERE id = $1', [id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Project not found' });
  res.json(result.rows[0]);
}));

app.patch('/api/projects/:id', asyncHandler(async (req, res) => {
  const { id } = IdParamSchema.parse(req.params);
  const data = UpdateProjectSchema.parse(req.body);
  
  const current = await query('SELECT * FROM projects WHERE id = $1', [id]);
  if (current.rowCount === 0) return res.status(404).json({ error: 'Project not found' });

  const result = await query(
    'UPDATE projects SET name = COALESCE($1, name), description = COALESCE($2, description) WHERE id = $3 RETURNING *',
    [data.name, data.description, id]
  );
  res.json(result.rows[0]);
}));

app.delete('/api/projects/:id', asyncHandler(async (req, res) => {
  const { id } = IdParamSchema.parse(req.params);
  const result = await query('DELETE FROM projects WHERE id = $1 RETURNING *', [id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Project not found' });
  res.json(result.rows[0]);
}));

// Nested Agents
app.get('/api/projects/:id/agents', asyncHandler(async (req, res) => {
  const { id } = IdParamSchema.parse(req.params);
  const project = await query('SELECT id FROM projects WHERE id = $1', [id]);
  if (project.rowCount === 0) return res.status(404).json({ error: 'Project not found' });

  const result = await query('SELECT * FROM agents WHERE project_id = $1 ORDER BY created_at DESC', [id]);
  res.json(result.rows);
}));

app.post('/api/projects/:id/agents', asyncHandler(async (req, res) => {
  const { id } = IdParamSchema.parse(req.params);
  const data = CreateAgentSchema.parse(req.body);

  const project = await query('SELECT id FROM projects WHERE id = $1', [id]);
  if (project.rowCount === 0) return res.status(404).json({ error: 'Project not found' });

  const result = await query(
    `INSERT INTO agents (project_id, name, site, goal_text, params, schedule_cron, jitter_min, enabled, notify, result_schema)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [id, data.name, data.site, data.goal_text, data.params, data.schedule_cron, data.jitter_min, data.enabled, data.notify, data.result_schema]
  );
  res.status(201).json(result.rows[0]);
}));

// Flat Agents
app.get('/api/agents/:id', asyncHandler(async (req, res) => {
  const { id } = IdParamSchema.parse(req.params);
  const result = await query('SELECT * FROM agents WHERE id = $1', [id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Agent not found' });
  res.json(result.rows[0]);
}));

app.get('/api/runs', asyncHandler(async (req, res) => {
  const { limit } = PaginationSchema.parse(req.query);
  const projectId = req.query.project_id as string | undefined;
  const agentId = req.query.agent_id as string | undefined;
  const status = req.query.status as string | undefined;

  let queryStr = `
    SELECT r.*, a.project_id, a.name as agent_name 
    FROM runs r 
    JOIN agents a ON r.agent_id = a.id 
    WHERE 1=1
  `;
  const params: any[] = [];

  if (projectId) {
    params.push(projectId);
    queryStr += ` AND a.project_id = $${params.length}`;
  }
  if (agentId) {
    params.push(agentId);
    queryStr += ` AND r.agent_id = $${params.length}`;
  }
  if (status) {
    params.push(status);
    queryStr += ` AND r.status = $${params.length}`;
  }

  params.push(limit);
  queryStr += ` ORDER BY r.created_at DESC LIMIT $${params.length}`;

  const result = await query(queryStr, params);
  res.json(result.rows);
}));

import path from 'path';

app.get('/api/screenshots/:file', (req, res) => {
  const file = req.params.file;
  if (!/^[a-zA-Z0-9_-]+\.png$/.test(file)) {
    return res.status(400).send('Invalid file name');
  }
  const screenshotsDir = process.env.SCREENSHOT_DIR || path.join(process.cwd(), 'data', 'screenshots');
  res.sendFile(path.join(screenshotsDir, file));
});

app.patch('/api/agents/:id', asyncHandler(async (req, res) => {
  const { id } = IdParamSchema.parse(req.params);
  const data = UpdateAgentSchema.parse(req.body);

  const current = await query('SELECT * FROM agents WHERE id = $1', [id]);
  if (current.rowCount === 0) return res.status(404).json({ error: 'Agent not found' });

  const result = await query(
    `UPDATE agents SET 
      name = COALESCE($1, name),
      site = COALESCE($2, site),
      goal_text = COALESCE($3, goal_text),
      params = COALESCE($4, params),
      schedule_cron = COALESCE($5, schedule_cron),
      jitter_min = COALESCE($6, jitter_min),
      enabled = COALESCE($7, enabled),
      notify = COALESCE($8, notify),
      result_schema = COALESCE($9, result_schema)
     WHERE id = $10 RETURNING *`,
    [data.name, data.site, data.goal_text, data.params, data.schedule_cron, data.jitter_min, data.enabled, data.notify, data.result_schema, id]
  );
  res.json(result.rows[0]);
}));

app.delete('/api/agents/:id', asyncHandler(async (req, res) => {
  const { id } = IdParamSchema.parse(req.params);
  const result = await query('DELETE FROM agents WHERE id = $1 RETURNING *', [id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Agent not found' });
  res.json(result.rows[0]);
}));

app.get('/api/agents/:id/runs', asyncHandler(async (req, res) => {
  const { id } = IdParamSchema.parse(req.params);
  const { limit } = PaginationSchema.parse(req.query);
  
  const agent = await query('SELECT id FROM agents WHERE id = $1', [id]);
  if (agent.rowCount === 0) return res.status(404).json({ error: 'Agent not found' });

  const result = await query('SELECT * FROM runs WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2', [id, limit]);
  res.json(result.rows);
}));

app.get('/api/agents/:id/results', asyncHandler(async (req, res) => {
  const { id } = IdParamSchema.parse(req.params);
  const { limit } = PaginationSchema.parse(req.query);
  
  const agent = await query('SELECT id FROM agents WHERE id = $1', [id]);
  if (agent.rowCount === 0) return res.status(404).json({ error: 'Agent not found' });

  const result = await query('SELECT * FROM results WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2', [id, limit]);
  res.json(result.rows);
}));

app.post('/api/agents/:id/trigger', asyncHandler(async (req, res) => {
  const { id } = IdParamSchema.parse(req.params);
  
  const agent = await query('SELECT id FROM agents WHERE id = $1', [id]);
  if (agent.rowCount === 0) return res.status(404).json({ error: 'Agent not found' });

  // Kill-Switch: bei globaler Pause keine manuelle Ausführung.
  const paused = await query(`SELECT value FROM settings WHERE key = 'paused'`);
  if (paused.rows[0]?.value === true) {
    return res.status(423).json({ error: 'Kill-Switch ist aktiv – Ausführung global pausiert.' });
  }

  const result = await query(`INSERT INTO runs (agent_id, status) VALUES ($1, 'queued') RETURNING *`, [id]);

  // Push to pg-boss (pg-boss v12: Queue muss existieren, bevor gesendet wird)
  if (boss) {
    const queueName = `agent-run-${id}`;
    try { await boss.createQueue(queueName); } catch { /* existiert bereits */ }
    await boss.send(queueName, {
      agent_id: id,
      run_id: result.rows[0].id,
      source: 'manual'
    }, {
      retryLimit: 2,
      retryBackoff: true
    });
  } else {
    console.warn('[API] DB_URL fehlt, Job konnte nicht an pg-boss gesendet werden.');
  }

  res.status(201).json(result.rows[0]);
}));

// --- Recorder (Schritt 19) ---------------------------------------------------

app.post('/api/agents/:id/recorder', asyncHandler(async (req, res) => {
  const { id } = IdParamSchema.parse(req.params);
  const agent = await query('SELECT id FROM agents WHERE id = $1', [id]);
  if (agent.rowCount === 0) return res.status(404).json({ error: 'Agent not found' });

  const result = await query(
    `INSERT INTO recorder_sessions (agent_id, status) VALUES ($1, 'running') RETURNING *`, [id]
  );
  const session = result.rows[0];

  if (boss) {
    try { await boss.createQueue('recorder'); } catch { /* existiert bereits */ }
    await boss.send('recorder', { session_id: session.id });
  } else {
    console.warn('[API] DB_URL fehlt, Recorder-Job nicht eingereiht.');
  }
  res.status(201).json(session);
}));

app.get('/api/recorder/:sid', asyncHandler(async (req, res) => {
  const { sid } = z.object({ sid: z.string().uuid() }).parse(req.params);
  const result = await query('SELECT * FROM recorder_sessions WHERE id = $1', [sid]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Session not found' });
  res.json(result.rows[0]);
}));

app.post('/api/recorder/:sid/abort', asyncHandler(async (req, res) => {
  const { sid } = z.object({ sid: z.string().uuid() }).parse(req.params);
  const result = await query(
    `UPDATE recorder_sessions SET status='aborted', updated_at=NOW()
     WHERE id=$1 AND status IN ('running','awaiting_confirm') RETURNING *`, [sid]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Session not found or not abortable' });
  res.json(result.rows[0]);
}));

app.post('/api/recorder/:sid/confirm', asyncHandler(async (req, res) => {
  const { sid } = z.object({ sid: z.string().uuid() }).parse(req.params);
  const sess = await query('SELECT * FROM recorder_sessions WHERE id = $1', [sid]);
  if (sess.rowCount === 0) return res.status(404).json({ error: 'Session not found' });
  const session = sess.rows[0];
  if (session.status !== 'awaiting_confirm' || !session.recipe_preview) {
    return res.status(400).json({ error: 'Session ist nicht bestätigungsbereit' });
  }

  const vRes = await query('SELECT COALESCE(MAX(version),0)+1 AS next FROM recipes WHERE agent_id = $1', [session.agent_id]);
  const version = vRes.rows[0].next;
  const rec = await query(
    'INSERT INTO recipes (agent_id, version, steps) VALUES ($1, $2, $3) RETURNING *',
    [session.agent_id, version, JSON.stringify(session.recipe_preview)]
  );
  await query(`UPDATE recorder_sessions SET status='completed', updated_at=NOW() WHERE id=$1`, [sid]);
  res.status(201).json({ recipe: rec.rows[0], version });
}));

// --- Settings & Admin (Schritt 21) -------------------------------------------

async function readSettings() {
  const { rows } = await query('SELECT key, value FROM settings');
  const map: Record<string, any> = {};
  for (const r of rows) map[r.key] = r.value;
  return {
    paused: map.paused === true,
    retention_days: typeof map.retention_days === 'number' ? map.retention_days : 30,
    notify: (map.notify && typeof map.notify === 'object') ? map.notify : {},
  };
}

app.get('/api/settings', asyncHandler(async (req, res) => {
  res.json(await readSettings());
}));

app.put('/api/settings', asyncHandler(async (req, res) => {
  const data = UpdateSettingsSchema.parse(req.body);
  for (const [k, v] of Object.entries(data)) {
    await query(
      `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
      [k, JSON.stringify(v)]
    );
  }
  res.json(await readSettings());
}));

app.post('/api/admin/cleanup', asyncHandler(async (req, res) => {
  if (boss) {
    try { await boss.createQueue('cleanup'); } catch { /* existiert bereits */ }
    await boss.send('cleanup', {});
  }
  res.json({ ok: true, queued: !!boss });
}));

// Prometheus-Metriken.
app.get('/metrics', asyncHandler(async (req, res) => {
  const byStatus = await query(`SELECT status, count(*)::int AS c FROM runs GROUP BY status`);
  const tokens = await query(`SELECT COALESCE(SUM(ai_tokens), 0)::int AS s FROM runs`);
  const queued = await query(`SELECT count(*)::int AS c FROM runs WHERE status = 'queued'`);

  let out = '';
  out += '# HELP checky_runs_total Anzahl Läufe nach Status\n# TYPE checky_runs_total counter\n';
  for (const r of byStatus.rows) out += `checky_runs_total{status="${r.status}"} ${r.c}\n`;
  out += '# HELP checky_ai_tokens_total Verbrauchte KI-Tokens gesamt\n# TYPE checky_ai_tokens_total counter\n';
  out += `checky_ai_tokens_total ${tokens.rows[0].s}\n`;
  out += '# HELP checky_queue_depth Anzahl wartender Läufe\n# TYPE checky_queue_depth gauge\n';
  out += `checky_queue_depth ${queued.rows[0].c}\n`;
  res.type('text/plain').send(out);
}));

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof z.ZodError) {
    return res.status(400).json({ error: 'Validation error: ' + (err as any).issues.map((e: any) => `${e.path.join('.')}: ${e.message}`).join(', ') });
  }
  console.error('[API Error]', err);
  
  if (err.message?.includes('Database is disabled')) {
    return res.status(503).json({ error: err.message });
  }
  
  res.status(500).json({ error: 'Internal Server Error' });
});
