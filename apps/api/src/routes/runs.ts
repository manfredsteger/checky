import { Router } from 'express';
import path from 'path';
import { query } from '../db.js';
import { asyncHandler, PaginationSchema } from '../lib/http.js';

export const runsRouter = Router();

// Läufe, gefiltert nach project_id / agent_id / status.
runsRouter.get('/api/runs', asyncHandler(async (req, res) => {
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

  if (projectId) { params.push(projectId); queryStr += ` AND a.project_id = $${params.length}`; }
  if (agentId)   { params.push(agentId);   queryStr += ` AND r.agent_id = $${params.length}`; }
  if (status)    { params.push(status);    queryStr += ` AND r.status = $${params.length}`; }

  params.push(limit);
  queryStr += ` ORDER BY r.created_at DESC LIMIT $${params.length}`;

  const result = await query(queryStr, params);
  res.json(result.rows);
}));

runsRouter.get('/api/screenshots/:file', (req, res) => {
  const file = req.params.file;
  if (!/^[a-zA-Z0-9_-]+\.png$/.test(file)) {
    return res.status(400).send('Invalid file name');
  }
  const screenshotsDir = process.env.SCREENSHOT_DIR || path.join(process.cwd(), 'data', 'screenshots');
  res.sendFile(path.join(screenshotsDir, file));
});
