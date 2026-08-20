import type { Pool } from 'pg';
import path from 'path';
import fs from 'fs';

const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || path.join(process.cwd(), 'data', 'screenshots');
const MAX_ATTEMPTS = 5;

export interface AppSettings {
  paused: boolean;
  retention_days: number;
  notify: {
    webhook_url?: string;
    matrix_homeserver?: string;
    matrix_token?: string;
    matrix_room?: string;
  };
}

export async function getSettings(pool: Pool): Promise<AppSettings> {
  const { rows } = await pool.query('SELECT key, value FROM settings');
  const map: Record<string, any> = {};
  for (const r of rows) map[r.key] = r.value;
  return {
    paused: map.paused === true,
    retention_days: typeof map.retention_days === 'number' ? map.retention_days : 30,
    notify: (map.notify && typeof map.notify === 'object') ? map.notify : {},
  };
}

// Legt je konfiguriertem Kanal einen Outbox-Eintrag an (transactional outbox).
export async function enqueueNotification(pool: Pool, payload: Record<string, any>): Promise<void> {
  const { notify } = await getSettings(pool);
  const channels: string[] = [];
  if (notify.webhook_url && /^https?:\/\//.test(notify.webhook_url)) channels.push('webhook');
  if (notify.matrix_homeserver && notify.matrix_token && notify.matrix_room) channels.push('matrix');
  for (const channel of channels) {
    await pool.query('INSERT INTO outbox (channel, payload) VALUES ($1, $2)', [channel, JSON.stringify(payload)]);
  }
}

async function deliver(channel: string, payload: any, notify: AppSettings['notify']): Promise<void> {
  if (channel === 'webhook') {
    const res = await fetch(notify.webhook_url!, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Webhook HTTP ${res.status}`);
  } else if (channel === 'matrix') {
    const base = notify.matrix_homeserver!.replace(/\/$/, '');
    const url = `${base}/_matrix/client/v3/rooms/${encodeURIComponent(notify.matrix_room!)}/send/m.room.message?access_token=${encodeURIComponent(notify.matrix_token!)}`;
    const body = {
      msgtype: 'm.text',
      body: `Checky: ${payload.agent} (${payload.project}) → ${payload.status}` +
        (payload.changed ? ' [geändert]' : '') + (payload.link ? `\n${payload.link}` : ''),
    };
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Matrix HTTP ${res.status}`);
  } else {
    throw new Error(`Unbekannter Kanal: ${channel}`);
  }
}

// Verarbeitet fällige Outbox-Einträge; Retry mit exponentiellem Backoff.
export async function processOutbox(pool: Pool): Promise<void> {
  const { rows } = await pool.query(
    `SELECT * FROM outbox WHERE status='pending' AND next_attempt_at <= NOW() ORDER BY created_at LIMIT 20`
  );
  if (rows.length === 0) return;
  const { notify } = await getSettings(pool);

  for (const row of rows) {
    try {
      await deliver(row.channel, row.payload, notify);
      await pool.query(`UPDATE outbox SET status='sent', sent_at=NOW() WHERE id=$1`, [row.id]);
    } catch (e: any) {
      const attempts = row.attempts + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      const backoffSec = Math.min(300, 10 * Math.pow(2, attempts));
      await pool.query(
        `UPDATE outbox SET attempts=$2, last_error=$3, status=$4, next_attempt_at=NOW() + ($5 || ' seconds')::interval WHERE id=$1`,
        [row.id, attempts, String(e?.message || e), failed ? 'failed' : 'pending', backoffSec]
      );
    }
  }
}

// Aufräumen: alte runs/results/Screenshots löschen, aber letzten Lauf je Agent behalten.
export async function runCleanup(pool: Pool): Promise<{ deletedRuns: number; deletedFiles: number }> {
  const { retention_days } = await getSettings(pool);

  // Zu löschende Läufe: älter als Retention UND nicht der jeweils neueste je Agent.
  const { rows: delRuns } = await pool.query(
    `SELECT id, screenshot_before, screenshot_after FROM runs
      WHERE created_at < NOW() - ($1 || ' days')::interval
        AND id NOT IN (SELECT DISTINCT ON (agent_id) id FROM runs ORDER BY agent_id, created_at DESC)`,
    [retention_days]
  );

  let deletedFiles = 0;
  for (const r of delRuns) {
    for (const p of [r.screenshot_before, r.screenshot_after]) {
      if (!p) continue;
      const file = path.join(SCREENSHOT_DIR, path.basename(p));
      try { fs.unlinkSync(file); deletedFiles++; } catch { /* schon weg */ }
    }
  }

  if (delRuns.length > 0) {
    // results hängen per ON DELETE CASCADE an runs.
    await pool.query(`DELETE FROM runs WHERE id = ANY($1)`, [delRuns.map((r: any) => r.id)]);
  }
  return { deletedRuns: delRuns.length, deletedFiles };
}

// Rate-Limit: max. N Läufe pro Tag pro Domain (bereits rate_limited-Läufe zählen nicht).
export async function checkRateLimit(pool: Pool, agentSite: string, runId: string): Promise<{ limited: boolean; count: number; limit: number }> {
  const { rows: srows } = await pool.query(`SELECT value FROM settings WHERE key = 'rate_limit_per_day'`);
  const limit = typeof srows[0]?.value === 'number' ? srows[0].value : 12;

  let host: string;
  try { host = new URL(agentSite).hostname; } catch { return { limited: false, count: 0, limit }; }

  const { rows: agents } = await pool.query('SELECT id, site FROM agents');
  const ids = agents
    .filter((a: any) => { try { return new URL(a.site).hostname === host; } catch { return false; } })
    .map((a: any) => a.id);
  if (ids.length === 0) return { limited: false, count: 0, limit };

  const { rows } = await pool.query(
    `SELECT count(*)::int AS c FROM runs
      WHERE agent_id = ANY($1) AND created_at::date = CURRENT_DATE
        AND id <> $2 AND (error IS DISTINCT FROM 'rate_limited')`,
    [ids, runId]
  );
  const count = rows[0].c;
  return { limited: count >= limit, count, limit };
}
