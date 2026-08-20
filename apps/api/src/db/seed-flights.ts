import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Importiert das Flug-Projekt + Agenten aus checky-agents-seed.json (idempotent).
const dbUrl = process.env.DB_URL;
if (!dbUrl) {
  console.error('[seed-flights] DB_URL fehlt.');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedPath = process.env.SEED_FILE || path.join(__dirname, '../../../../checky-agents-seed.json');

interface SeedAgent {
  name: string; site: string; goal_text: string; schedule_cron: string;
  priority?: number; note?: string; result_schema?: any; params?: Record<string, any>;
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(seedPath, 'utf-8')) as {
    project: { name: string; description?: string };
    defaults: { params: Record<string, any>; result_schema: any };
    agents: SeedAgent[];
  };

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    let projectId: string;
    const projRes = await client.query('SELECT id FROM projects WHERE name = $1', [raw.project.name]);
    if (projRes.rowCount === 0) {
      const ins = await client.query(
        'INSERT INTO projects (name, description) VALUES ($1, $2) RETURNING id',
        [raw.project.name, raw.project.description ?? null]
      );
      projectId = ins.rows[0].id;
      console.log(`[seed-flights] Projekt angelegt: ${raw.project.name}`);
    } else {
      projectId = projRes.rows[0].id;
      console.log(`[seed-flights] Projekt existiert bereits: ${raw.project.name}`);
    }

    let created = 0, skipped = 0;
    for (const a of raw.agents) {
      const ex = await client.query('SELECT id FROM agents WHERE project_id = $1 AND name = $2', [projectId, a.name]);
      if ((ex.rowCount ?? 0) > 0) { skipped++; continue; }
      const params = { ...raw.defaults.params, ...(a.params ?? {}), _priority: a.priority ?? 3, _note: a.note ?? '' };
      const schema = a.result_schema ?? raw.defaults.result_schema;
      await client.query(
        `INSERT INTO agents (project_id, name, site, goal_text, params, schedule_cron, enabled, result_schema)
         VALUES ($1, $2, $3, $4, $5, $6, false, $7)`,
        [projectId, a.name, a.site, a.goal_text, JSON.stringify(params), a.schedule_cron, JSON.stringify(schema)]
      );
      created++;
    }
    console.log(`[seed-flights] Agenten: ${created} angelegt, ${skipped} übersprungen. Alle deaktiviert – pro Quelle einmal per Recorder anlernen, dann aktivieren.`);
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error('[seed-flights]', e); process.exit(1); });
