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
    console.log('Clearing existing data (Cascade deletes agents, etc.)...');
    await client.query('DELETE FROM projects');

    console.log('Inserting Demo Project...');
    const projRes = await client.query(`
      INSERT INTO projects (name, description)
      VALUES ('Demo', 'Demo project for Checky')
      RETURNING id;
    `);
    const projectId = projRes.rows[0].id;

    console.log('Inserting Bücher-Preis-Check Agent...');
    const resultSchema = {
      title: "string",
      price: "string",
      availability: "string"
    };

    await client.query(`
      INSERT INTO agents (project_id, name, site, goal_text, schedule_cron, result_schema)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      projectId,
      'Bücher-Preis-Check',
      'https://books.toscrape.com',
      'Finde das Buch ‚A Light in the Attic\' und lies Preis und Verfügbarkeit aus',
      '0 8 * * *',
      JSON.stringify(resultSchema)
    ]);

    console.log('Seeding completed successfully!');
  } catch (e) {
    console.error('Seeding failed:', e);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runSeed();
