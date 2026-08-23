import { Router } from 'express';
import { CreateAgentSchema, UpdateAgentSchema } from '@checky/shared';
import { query } from '../db.js';
import { asyncHandler, IdParamSchema, PaginationSchema } from '../lib/http.js';
import { enqueue } from '../lib/boss.js';
import { searchKeyOf, describeSearchDiff } from '@checky/shared';

export const agentsRouter = Router();

// Agenten-Liste eines Projekts (mit has_recipe: „ist angelernt?").
agentsRouter.get('/api/projects/:id/agents', asyncHandler(async (req, res) => {
  const { id } = IdParamSchema.parse(req.params);
  const project = await query('SELECT id FROM projects WHERE id = $1', [id]);
  if (project.rowCount === 0) return res.status(404).json({ error: 'Project not found' });

  const result = await query(
    `SELECT a.*, EXISTS(SELECT 1 FROM recipes r WHERE r.agent_id = a.id) AS has_recipe
     FROM agents a WHERE a.project_id = $1 ORDER BY a.created_at DESC`, [id]);
  res.json(result.rows);
}));

agentsRouter.post('/api/projects/:id/agents', asyncHandler(async (req, res) => {
  const { id } = IdParamSchema.parse(req.params);
  const data = CreateAgentSchema.parse(req.body);

  const project = await query('SELECT id FROM projects WHERE id = $1', [id]);
  if (project.rowCount === 0) return res.status(404).json({ error: 'Project not found' });

  const result = await query(
    `INSERT INTO agents (project_id, name, site, goal_text, params, schedule_cron, jitter_min, enabled, notify, result_schema, provider)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [id, data.name, data.site, data.goal_text, data.params, data.schedule_cron, data.jitter_min, data.enabled, data.notify, data.result_schema, data.provider ?? null]
  );
  const agent = result.rows[0];

  // Starthilfe: bringt der Blueprint ein fertiges Recipe mit, wird es sofort als
  // v1 hinterlegt — der Agent ist damit ohne Anlern-Lauf lauffähig.
  if (data.recipe?.length) {
    await query('INSERT INTO recipes (agent_id, version, steps) VALUES ($1, 1, $2)', [agent.id, JSON.stringify(data.recipe)]);
    agent.has_recipe = true;
  }
  res.status(201).json(agent);
}));

agentsRouter.get('/api/agents/:id', asyncHandler(async (req, res) => {
  const { id } = IdParamSchema.parse(req.params);
  const result = await query(
    `SELECT a.*, EXISTS(SELECT 1 FROM recipes r WHERE r.agent_id = a.id) AS has_recipe
     FROM agents a WHERE a.id = $1`, [id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Agent not found' });
  res.json(result.rows[0]);
}));

agentsRouter.patch('/api/agents/:id', asyncHandler(async (req, res) => {
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
      result_schema = COALESCE($9, result_schema),
      provider = COALESCE($10, provider)
     WHERE id = $11 RETURNING *`,
    [data.name, data.site, data.goal_text, data.params, data.schedule_cron, data.jitter_min, data.enabled, data.notify, data.result_schema, data.provider ?? null, id]
  );
  const updated = result.rows[0];

  // Wie beim Projekt: nur eine echte Änderung der Suche stößt eine Neumessung
  // an — Wunschpreis & Co. ändern nur die Darstellung.
  let requeue = { searchChanged: false, requeued: 0, diff: [] as string[] };
  if (data.params !== undefined) {
    const proj = await query('SELECT params FROM projects WHERE id = $1', [updated.project_id]);
    const pp = proj.rows[0]?.params || {};
    const before = { ...pp, ...(current.rows[0].params || {}) };
    const after = { ...pp, ...(updated.params || {}) };
    if (searchKeyOf(before) !== searchKeyOf(after)) {
      requeue.searchChanged = true;
      requeue.diff = describeSearchDiff(before, after);
      if (updated.enabled) {
        try {
          const run = await query(`INSERT INTO runs (agent_id, status) VALUES ($1, 'queued') RETURNING id`, [id]);
          await enqueue('agent-run', { agent_id: id, run_id: run.rows[0].id, source: 'params-change' });
          requeue.requeued = 1;
        } catch (e) { console.error('[API] Neumessung nach Agent-Parameteränderung fehlgeschlagen:', e); }
      }
    }
  }
  res.json({ ...updated, requeue });
}));

agentsRouter.delete('/api/agents/:id', asyncHandler(async (req, res) => {
  const { id } = IdParamSchema.parse(req.params);
  const result = await query('DELETE FROM agents WHERE id = $1 RETURNING *', [id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Agent not found' });
  res.json(result.rows[0]);
}));

agentsRouter.get('/api/agents/:id/runs', asyncHandler(async (req, res) => {
  const { id } = IdParamSchema.parse(req.params);
  const { limit } = PaginationSchema.parse(req.query);

  const agent = await query('SELECT id FROM agents WHERE id = $1', [id]);
  if (agent.rowCount === 0) return res.status(404).json({ error: 'Agent not found' });

  const result = await query('SELECT * FROM runs WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2', [id, limit]);
  res.json(result.rows);
}));

agentsRouter.get('/api/agents/:id/results', asyncHandler(async (req, res) => {
  const { id } = IdParamSchema.parse(req.params);
  const { limit } = PaginationSchema.parse(req.query);

  const agent = await query('SELECT id FROM agents WHERE id = $1', [id]);
  if (agent.rowCount === 0) return res.status(404).json({ error: 'Agent not found' });

  const result = await query('SELECT * FROM results WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2', [id, limit]);
  res.json(result.rows);
}));

agentsRouter.post('/api/agents/:id/trigger', asyncHandler(async (req, res) => {
  const { id } = IdParamSchema.parse(req.params);

  const agent = await query('SELECT id FROM agents WHERE id = $1', [id]);
  if (agent.rowCount === 0) return res.status(404).json({ error: 'Agent not found' });

  // Kill-Switch: bei globaler Pause keine manuelle Ausführung.
  const paused = await query(`SELECT value FROM settings WHERE key = 'paused'`);
  if (paused.rows[0]?.value === true) {
    return res.status(423).json({ error: 'Kill-Switch ist aktiv – Ausführung global pausiert.' });
  }

  const result = await query(`INSERT INTO runs (agent_id, status) VALUES ($1, 'queued') RETURNING *`, [id]);
  // Geteilte "agent-run"-Queue: hat immer einen Worker -> sofortiger Lauf,
  // kein Warten auf die per-Agent-Queue-Registrierung (60s-Poll).
  await enqueue('agent-run',
    { agent_id: id, run_id: result.rows[0].id, source: 'manual' },
    { retryLimit: 2, retryBackoff: true });

  res.status(201).json(result.rows[0]);
}));
