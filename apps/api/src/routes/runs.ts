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

// Live-Aktivität: alle Läufe, die gerade warten oder laufen — plus eine
// Erwartungsdauer je Agent (Median der letzten erfolgreichen Läufe), damit die
// Oberfläche einen echten Fortschrittsbalken statt nur einen Spinner zeigen kann.
runsRouter.get('/api/activity', asyncHandler(async (_req, res) => {
  const active = await query(`
    SELECT r.id AS run_id, r.agent_id, r.status, r.created_at, r.started_at,
           a.project_id, a.name AS agent_name
    FROM runs r
    JOIN agents a ON r.agent_id = a.id
    WHERE r.status IN ('queued', 'running')
    ORDER BY r.created_at ASC
    LIMIT 200
  `);

  // Erwartungsdauer nur für die gerade aktiven Agenten berechnen.
  const agentIds: string[] = [...new Set(active.rows.map(r => r.agent_id))];
  const eta: Record<string, number> = {};
  if (agentIds.length > 0) {
    const durations = await query(`
      SELECT agent_id, AVG(EXTRACT(EPOCH FROM (finished_at - started_at))) AS avg_sec
      FROM (
        SELECT agent_id, started_at, finished_at,
               ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY finished_at DESC) AS rn
        FROM runs
        WHERE agent_id = ANY($1::uuid[])
          AND status IN ('succeeded', 'healed')
          AND started_at IS NOT NULL AND finished_at IS NOT NULL
      ) t
      WHERE rn <= 5
      GROUP BY agent_id
    `, [agentIds]);
    for (const row of durations.rows) {
      const sec = Number(row.avg_sec);
      if (Number.isFinite(sec) && sec > 0) eta[row.agent_id] = sec;
    }
  }

  // Kürzlich beendete Läufe: API-Quellen sind oft in Millisekunden fertig — ohne
  // diese Quittung sähe die Oberfläche von so einem Lauf überhaupt nichts.
  const recent = await query(`
    SELECT r.id AS run_id, r.agent_id, r.status, r.finished_at, r.error, a.project_id
    FROM runs r
    JOIN agents a ON r.agent_id = a.id
    WHERE r.finished_at > NOW() - INTERVAL '20 seconds'
    ORDER BY r.finished_at DESC
    LIMIT 100
  `);

  res.json({ runs: active.rows, recent: recent.rows, eta, server_time: new Date().toISOString() });
}));
