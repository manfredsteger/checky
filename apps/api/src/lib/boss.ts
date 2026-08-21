// @ts-ignore
import { PgBoss } from 'pg-boss';

// Zentrale pg-boss-Instanz. Ein einziger Ort, an dem die Queue-Verbindung
// lebt; alle Routen-Module teilen sie über getBoss()/enqueue().
const dbUrl = process.env.DB_URL;
let boss: PgBoss | null = null;

if (dbUrl) {
  boss = new PgBoss(dbUrl);
  boss.on('error', (error: any) => console.error('[API pg-boss error]', error));
  boss.start().catch(console.error);
} else {
  console.warn('[API] WARNUNG: DB_URL fehlt. PgBoss deaktiviert.');
}

export function getBoss(): PgBoss | null {
  return boss;
}

// Reiht einen Job ein und legt die Queue bei Bedarf an (pg-boss v12
// verlangt, dass die Queue vor dem ersten send() existiert).
export async function enqueue(queue: string, data: any, opts?: any): Promise<boolean> {
  if (!boss) {
    console.warn(`[API] DB_URL fehlt, Job für Queue "${queue}" nicht eingereiht.`);
    return false;
  }
  try { await boss.createQueue(queue); } catch { /* existiert bereits */ }
  await boss.send(queue, data, opts);
  return true;
}
