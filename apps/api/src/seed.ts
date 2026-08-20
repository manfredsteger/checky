import pg from 'pg';
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const dbUrl = process.env.DB_URL;
if (!dbUrl) {
  console.log('[Seed] No DB_URL found. Seeding skipped.');
  process.exit(0);
}

const pool = new pg.Pool({ connectionString: dbUrl });

async function seed() {
  console.log('[Seed] Starting database seed...');
  
  // Create Project
  const projectRes = await pool.query(
    `INSERT INTO projects (name, description) VALUES ($1, $2) RETURNING id`,
    ['Buch-Scraper 2027', 'Demo-Projekt für das Worker Playwright System']
  );
  const projectId = projectRes.rows[0].id;
  
  // Create Agent
  const agentRes = await pool.query(
    `INSERT INTO agents (project_id, name, site, goal_text, params, schedule_cron, jitter_min, enabled, result_schema)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      projectId,
      'Bücher-Preis-Check',
      'https://books.toscrape.com',
      'Preise von Büchern überwachen',
      JSON.stringify({ book_title: 'A Light in the Attic' }),
      '0 * * * *', // hourly
      5,
      true,
      JSON.stringify({
        type: 'object',
        properties: {
          title: { type: 'string' },
          price: { type: 'string' },
          availability: { type: 'string' }
        }
      })
    ]
  );
  const agentId = agentRes.rows[0].id;

  // Create Recipe (v1)
  const recipeSteps = [
    { action: 'goto', url: 'https://books.toscrape.com' },
    { action: 'click', selector: `getByRole('link', { name: '{{book_title}}' })` },
    { action: 'waitFor', selector: 'div.product_main' },
    { 
      action: 'extract', 
      mode: 'dom_map', 
      map: {
        title: 'getByRole("heading", { name: "{{book_title}}" })',
        price: 'p.price_color',
        availability: 'p.instock.availability'
      }
    }
  ];

  await pool.query(
    `INSERT INTO recipes (agent_id, version, steps) VALUES ($1, $2, $3)`,
    [agentId, 1, JSON.stringify(recipeSteps)]
  );

  console.log('[Seed] Seed completed successfully.');
  console.log(`[Seed] Seeded Project ID: ${projectId}`);
  console.log(`[Seed] Seeded Agent ID: ${agentId}`);
  
  await pool.end();
}

seed().catch(err => {
  console.error('[Seed] Failed:', err);
  process.exit(1);
});
