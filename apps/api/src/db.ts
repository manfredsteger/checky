import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;

export const pool = process.env.DB_URL ? new Pool({
  connectionString: process.env.DB_URL,
}) : null;

let pglite: PGlite | null = null;
let pgliteInitPromise: Promise<void> | null = null;

if (!pool) {
  console.log('[API] PREVIEW MODE: DB_URL missing, initializing in-memory PGlite database as fallback...');
  pglite = new PGlite();
  
  const initDb = async () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const schema1 = fs.readFileSync(path.join(__dirname, '../migrations/1715000000000_init_schema.up.sql'), 'utf-8');
    const schema2 = fs.readFileSync(path.join(__dirname, '../migrations/1787065788000_add_settings_table.up.sql'), 'utf-8');
    
    const safeSchema1 = schema1
      .replace(/uuid_generate_v4\(\)/g, 'gen_random_uuid()')
      .replace(/CREATE EXTENSION IF NOT EXISTS "uuid-ossp";/g, '');
      
    await pglite!.exec(safeSchema1);
    await pglite!.exec(schema2);
    
    // Add a demo project so the UI has something to show
    await pglite!.query(`INSERT INTO projects (name, description) VALUES ('Demo Project (PGlite)', 'This project was created in the local in-memory DB.')`);
    console.log('[API] PGlite initialized successfully with schema.');
  };
  
  pgliteInitPromise = initDb();
}

export const query = async (text: string, params?: any[]) => {
  if (pool) {
    return pool.query(text, params);
  } else if (pglite && pgliteInitPromise) {
    await pgliteInitPromise;
    return pglite.query(text, params);
  } else {
    throw new Error('Database is disabled (DB_URL is missing).');
  }
};
