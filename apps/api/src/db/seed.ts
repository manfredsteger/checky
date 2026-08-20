import pg from 'pg';
const { Client } = pg;

async function runSeed() {
  const dbUrl = process.env.DB_URL;
  if (!dbUrl) {
    console.error('ERROR: Missing DB_URL environment variable');
    process.exit(1);
  }

  const client = new Client({ connectionString: dbUrl });
  await client.connect();

  try {
    console.log('[Seed] Clearing existing data (Cascade deletes agents, recipes, runs, results)...');
    await client.query('DELETE FROM projects');

    console.log('[Seed] Inserting Demo project...');
    const projRes = await client.query(
      `INSERT INTO projects (name, description) VALUES ($1, $2) RETURNING id`,
      ['Demo', 'Demo-Projekt für Checky']
    );
    const projectId = projRes.rows[0].id;

    console.log('[Seed] Inserting Bücher-Preis-Check agent...');
    const resultSchema = {
      type: 'object',
      properties: {
        title: { type: 'string' },
        price: { type: 'string' },
        availability: { type: 'string' },
      },
    };

    const agentRes = await client.query(
      `INSERT INTO agents (project_id, name, site, goal_text, params, schedule_cron, result_schema)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        projectId,
        'Bücher-Preis-Check',
        'https://books.toscrape.com',
        "Finde das Buch ‚A Light in the Attic' und lies Preis und Verfügbarkeit aus",
        JSON.stringify({ book_title: 'A Light in the Attic' }),
        '0 8 * * *',
        JSON.stringify(resultSchema),
      ]
    );
    const agentId = agentRes.rows[0].id;

    console.log('[Seed] Inserting Recipe v1 (deterministischer Regelbetrieb)...');
    const recipeSteps = [
      {
        action: 'goto',
        url: 'https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html',
      },
      { action: 'waitFor', selector: 'div.product_main' },
      {
        action: 'extract',
        mode: 'dom_map',
        map: {
          title: '.product_main h1',
          price: '.product_main p.price_color',
          availability: '.product_main p.availability',
        },
      },
    ];

    await client.query(
      `INSERT INTO recipes (agent_id, version, steps) VALUES ($1, $2, $3)`,
      [agentId, 1, JSON.stringify(recipeSteps)]
    );

    console.log('[Seed] Seeding completed successfully.');
    console.log(`[Seed] Project ID: ${projectId}`);
    console.log(`[Seed] Agent ID:   ${agentId}`);
  } catch (e) {
    console.error('[Seed] Seeding failed:', e);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runSeed();
