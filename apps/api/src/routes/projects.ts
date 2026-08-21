import { Router } from 'express';
import { CreateProjectSchema, UpdateProjectSchema } from '@checky/shared';
import { query } from '../db.js';
import { asyncHandler, IdParamSchema } from '../lib/http.js';

export const projectsRouter = Router();

projectsRouter.get('/api/projects', asyncHandler(async (_req, res) => {
  const result = await query('SELECT * FROM projects ORDER BY created_at DESC');
  res.json(result.rows);
}));

projectsRouter.post('/api/projects', asyncHandler(async (req, res) => {
  const data = CreateProjectSchema.parse(req.body);
  const result = await query(
    'INSERT INTO projects (name, description, manifest_id, params) VALUES ($1, $2, $3, $4) RETURNING *',
    [data.name, data.description || null, data.manifest_id || null, JSON.stringify(data.params || {})]
  );
  res.status(201).json(result.rows[0]);
}));

projectsRouter.get('/api/projects/:id', asyncHandler(async (req, res) => {
  const { id } = IdParamSchema.parse(req.params);
  const result = await query('SELECT * FROM projects WHERE id = $1', [id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Project not found' });
  res.json(result.rows[0]);
}));

projectsRouter.patch('/api/projects/:id', asyncHandler(async (req, res) => {
  const { id } = IdParamSchema.parse(req.params);
  const data = UpdateProjectSchema.parse(req.body);

  const current = await query('SELECT * FROM projects WHERE id = $1', [id]);
  if (current.rowCount === 0) return res.status(404).json({ error: 'Project not found' });

  const result = await query(
    `UPDATE projects SET
       name = COALESCE($1, name),
       description = COALESCE($2, description),
       manifest_id = COALESCE($3, manifest_id),
       params = COALESCE($4, params)
     WHERE id = $5 RETURNING *`,
    [data.name, data.description, data.manifest_id, data.params ? JSON.stringify(data.params) : null, id]
  );
  res.json(result.rows[0]);
}));

projectsRouter.delete('/api/projects/:id', asyncHandler(async (req, res) => {
  const { id } = IdParamSchema.parse(req.params);
  const result = await query('DELETE FROM projects WHERE id = $1 RETURNING *', [id]);
  if (result.rowCount === 0) return res.status(404).json({ error: 'Project not found' });
  res.json(result.rows[0]);
}));
