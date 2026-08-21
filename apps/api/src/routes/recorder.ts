import { Router } from 'express';
import { query } from '../db.js';
import { asyncHandler, IdParamSchema, SidParamSchema } from '../lib/http.js';
import { enqueue } from '../lib/boss.js';
import { z } from 'zod';

export const recorderRouter = Router();

// Recorder-Session für einen Agenten starten (auto | assisted).
recorderRouter.post('/api/agents/:id/recorder', asyncHandler(async (req, res) => {
  const { id } = IdParamSchema.parse(req.params);
  const agent = await query('SELECT id FROM agents WHERE id = $1', [id]);
  if (agent.rowCount === 0) return res.status(404).json({ error: 'Agent not found' });

  const mode = req.body?.mode === 'assisted' ? 'assisted' : 'auto';
  const result = await query(
    `INSERT INTO recorder_sessions (agent_id, status, mode) VALUES ($1, 'running', $2) RETURNING *`, [id, mode]
  );
  const session = result.rows[0];
  await enqueue('recorder', { session_id: session.id });
  res.status(201).json(session);
}));

recorderRouter.get('/api/recorder/:sid', asyncHandler(async (req, res) => {
  const { sid } = SidParamSchema.parse(req.params);
  const result = await query('SELECT * FROM recorder_sessions WHERE id = $1', [sid]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Session not found' });
  res.json(result.rows[0]);
}));

// Assistierter Modus: Nutzer schickt eine Anweisung an die laufende Session.
recorderRouter.post('/api/recorder/:sid/instruct', asyncHandler(async (req, res) => {
  const { sid } = SidParamSchema.parse(req.params);
  const { text } = z.object({ text: z.string().min(1) }).parse(req.body);
  const result = await query(
    `UPDATE recorder_sessions SET pending_instruction=$2, status='running', updated_at=NOW()
     WHERE id=$1 AND mode='assisted' AND status IN ('awaiting_instruction','running') RETURNING *`,
    [sid, text]
  );
  if (result.rowCount === 0) return res.status(409).json({ error: 'Session nimmt gerade keine Anweisung an' });
  res.json(result.rows[0]);
}));

// Assistierter Modus: Aufnahme beenden -> Recipe destillieren.
recorderRouter.post('/api/recorder/:sid/finish', asyncHandler(async (req, res) => {
  const { sid } = SidParamSchema.parse(req.params);
  const result = await query(
    `UPDATE recorder_sessions SET pending_instruction='__FINISH__', status='running', updated_at=NOW()
     WHERE id=$1 AND mode='assisted' AND status IN ('awaiting_instruction','running') RETURNING *`,
    [sid]
  );
  if (result.rowCount === 0) return res.status(409).json({ error: 'Session kann nicht abgeschlossen werden' });
  res.json(result.rows[0]);
}));

recorderRouter.post('/api/recorder/:sid/abort', asyncHandler(async (req, res) => {
  const { sid } = SidParamSchema.parse(req.params);
  const result = await query(
    `UPDATE recorder_sessions SET status='aborted', updated_at=NOW()
     WHERE id=$1 AND status IN ('running','awaiting_instruction','awaiting_confirm') RETURNING *`, [sid]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Session not found or not abortable' });
  res.json(result.rows[0]);
}));

// Vorschau bestätigen -> als neue Recipe-Version speichern.
recorderRouter.post('/api/recorder/:sid/confirm', asyncHandler(async (req, res) => {
  const { sid } = SidParamSchema.parse(req.params);
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
