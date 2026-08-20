import pg from 'pg';
import { PgBoss } from 'pg-boss';

const dbUrl = process.env.DB_URL;

async function runOnce() {
  if (!dbUrl) {
    console.error("Fehler: DB_URL fehlt.");
    process.exit(1);
  }
  const profile = process.env.PROFILE;
  if (!profile) {
    console.error("Please provide PROFILE=<agent-id or name> as an environment variable or argument.");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: dbUrl });
  const { rows: agents } = await pool.query('SELECT * FROM agents WHERE id::text = $1 OR name = $1 LIMIT 1', [profile]);
  
  if (agents.length === 0) {
    console.error("Agent not found.");
    process.exit(1);
  }
  const agent = agents[0];

  const boss = new PgBoss(dbUrl);
  await boss.start();

  const { rows: runs } = await pool.query(
    `INSERT INTO runs (agent_id, status) VALUES ($1, 'queued') RETURNING id`,
    [agent.id]
  );

  const queueName = `agent-run-${agent.id}`;
  try { await boss.createQueue(queueName); } catch { /* existiert bereits */ }
  const jobId = await boss.send(queueName, {
    agent_id: agent.id,
    run_id: runs[0].id,
    source: 'cli'
  }, {
    retryLimit: 2,
    retryBackoff: true
  });

  console.log(`[CLI] Job queued with pg-boss ID ${jobId} for Run ID ${runs[0].id} (Agent: ${agent.name})`);
  await boss.stop();
  await pool.end();
}

runOnce().catch(console.error);
