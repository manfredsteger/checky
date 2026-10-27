#!/usr/bin/env node
// Private Daten von Checky AUSSERHALB des Repos sichern und wieder einspielen.
//
//   node scripts/checky-privat.mjs sichern            Komplett-Sicherung (DB-Dump) + alle Rezepte
//   node scripts/checky-privat.mjs rezepte            nur Rezepte schreiben (ein JSON je Projekt)
//   node scripts/checky-privat.mjs laden <datei…>     Rezept(e) einspielen (fehlende Projekte/Agenten anlegen)
//   node scripts/checky-privat.mjs liste              vorhandene Sicherungen und Rezepte zeigen
//
// Ablageort: CHECKY_PRIVAT_DIR (Umgebung oder .env), sonst ./privat (gitignored).
//
// Ein Rezept = ein Projekt mit allen Agenten und deren zuletzt gelernten Schritten — ohne
// Ergebnisse, Läufe und ohne Einstellungen (Zugangsdaten bleiben in der DB bzw. im Dump).
// Rezepte sind zum Nachnutzen gedacht: eine Kopie umbenennen, Werte anpassen, laden.
// Der DB-Dump enthält ALLES inkl. Zugangsdaten und gehört darum nur in den privaten Ordner.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BEHALTEN = Number(process.env.CHECKY_SICHERUNGEN_BEHALTEN || 14);

function privatDir() {
  let dir = process.env.CHECKY_PRIVAT_DIR;
  if (!dir) {
    try {
      const zeile = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n').find(z => z.startsWith('CHECKY_PRIVAT_DIR='));
      if (zeile) dir = zeile.slice('CHECKY_PRIVAT_DIR='.length).trim().replace(/^["']|["']$/g, '');
    } catch { /* keine .env */ }
  }
  dir = dir || path.join(ROOT, 'privat');
  if (dir.startsWith('~/')) dir = path.join(os.homedir(), dir.slice(2));
  return path.resolve(ROOT, dir);
}

function psql(args, input) {
  const r = spawnSync('docker', ['compose', 'exec', '-T', 'db', 'psql', '-U', 'checky', '-d', 'checky', '-v', 'ON_ERROR_STOP=1', ...args],
    { cwd: ROOT, input, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`psql fehlgeschlagen: ${(r.stderr || r.error?.message || '').trim()}`);
  return r;
}

const slug = s => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'projekt';
const stempel = () => new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');

// Ein Projekt je Zeile als kompaktes JSON (Zeilenumbrüche in Texten sind im JSON escaped).
const EXPORT_SQL = `
SELECT jsonb_build_object(
  'kind', 'checky-rezept', 'version', 1,
  'project', jsonb_build_object('name', p.name, 'description', p.description, 'manifest_id', p.manifest_id, 'params', p.params),
  'agents', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'name', a.name, 'site', a.site, 'goal_text', a.goal_text, 'params', a.params,
      'schedule_cron', a.schedule_cron, 'jitter_min', a.jitter_min, 'enabled', a.enabled,
      'notify', a.notify, 'result_schema', a.result_schema, 'provider', a.provider,
      'rezept', (SELECT r.steps FROM recipes r WHERE r.agent_id = a.id ORDER BY r.version DESC LIMIT 1)
    ) ORDER BY a.name)
    FROM agents a WHERE a.project_id = p.id), '[]'::jsonb)
)::text
FROM projects p ORDER BY p.name;`;

function rezepteSchreiben(ziel) {
  const out = psql(['-At', '-c', EXPORT_SQL]).stdout.split('\n').filter(Boolean);
  const dir = path.join(ziel, 'rezepte');
  fs.mkdirSync(dir, { recursive: true });
  const geschrieben = new Set();
  for (const zeile of out) {
    const rezept = JSON.parse(zeile);
    let name = slug(rezept.project.name);
    while (geschrieben.has(name)) name += '-2';
    geschrieben.add(name);
    fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(rezept, null, 2) + '\n');
  }
  console.log(`✓ ${out.length} Rezepte → ${dir}`);
  return out.length;
}

function sichern(ziel) {
  const dir = path.join(ziel, 'sicherung');
  fs.mkdirSync(dir, { recursive: true });
  const datei = path.join(dir, `checky-${stempel()}.sql.gz`);
  const r = spawnSync('bash', ['-c', `set -o pipefail; docker compose exec -T db pg_dump -U checky -d checky --clean --if-exists | gzip -9 > "${datei}"`],
    { cwd: ROOT, encoding: 'utf8' });
  const groesse = fs.existsSync(datei) ? fs.statSync(datei).size : 0;
  if (r.status !== 0 || groesse < 1000) { try { fs.unlinkSync(datei); } catch {} throw new Error(`DB-Sicherung fehlgeschlagen: ${r.stderr?.trim()}`); }
  console.log(`✓ DB-Sicherung ${(groesse / 1024 / 1024).toFixed(1)} MB → ${datei}`);
  const alt = fs.readdirSync(dir).filter(f => /^checky-\d{8}-\d{4}\.sql\.gz$/.test(f)).sort().reverse().slice(BEHALTEN);
  for (const f of alt) fs.unlinkSync(path.join(dir, f));
  if (alt.length) console.log(`  ${alt.length} ältere Sicherung(en) entfernt (behalten: ${BEHALTEN})`);
  rezepteSchreiben(ziel);
}

function laden(dateien) {
  if (!dateien.length) throw new Error('Datei angeben: node scripts/checky-privat.mjs laden <rezept.json> [weitere…]');
  for (const datei of dateien) {
    const rezept = JSON.parse(fs.readFileSync(datei, 'utf8'));
    if (rezept?.kind !== 'checky-rezept' || !rezept.project?.name || !Array.isArray(rezept.agents)) throw new Error(`${datei}: kein Checky-Rezept`);
    const text = JSON.stringify(rezept);
    let tag; do { tag = 'r' + crypto.randomBytes(6).toString('hex'); } while (text.includes(`$${tag}$`));
    const sql = `
DO $do$
DECLARE j jsonb := $${tag}$${text}$${tag}$::jsonb; pid uuid; aid uuid; a jsonb; neu int := 0; da int := 0;
BEGIN
  SELECT id INTO pid FROM projects WHERE name = j#>>'{project,name}' LIMIT 1;
  IF pid IS NULL THEN
    INSERT INTO projects (name, description, manifest_id, params)
    VALUES (j#>>'{project,name}', j#>>'{project,description}', j#>>'{project,manifest_id}', coalesce(j#>'{project,params}', '{}'::jsonb))
    RETURNING id INTO pid;
  END IF;
  FOR a IN SELECT * FROM jsonb_array_elements(j->'agents') LOOP
    IF EXISTS (SELECT 1 FROM agents WHERE project_id = pid AND name = a->>'name') THEN da := da + 1; CONTINUE; END IF;
    INSERT INTO agents (project_id, name, site, goal_text, params, schedule_cron, jitter_min, enabled, notify, result_schema, provider)
    VALUES (pid, a->>'name', a->>'site', a->>'goal_text', coalesce(a->'params', '{}'::jsonb), a->>'schedule_cron',
            coalesce((a->>'jitter_min')::int, 0), coalesce((a->>'enabled')::boolean, false),
            coalesce(a->'notify', '{}'::jsonb), coalesce(a->'result_schema', '{}'::jsonb), a->>'provider')
    RETURNING id INTO aid;
    IF jsonb_typeof(a->'rezept') = 'array' THEN INSERT INTO recipes (agent_id, version, steps) VALUES (aid, 1, a->'rezept'); END IF;
    neu := neu + 1;
  END LOOP;
  RAISE NOTICE 'ERGEBNIS % angelegt, % schon vorhanden', neu, da;
END $do$;`;
    const r = psql(['-q', '-f', '-'], sql);
    const m = /ERGEBNIS (\d+) angelegt, (\d+) schon vorhanden/.exec(r.stderr);
    console.log(`✓ ${rezept.project.name}: ${m ? `${m[1]} Agenten angelegt, ${m[2]} schon vorhanden` : 'geladen'}`);
  }
  console.log('  Der Worker übernimmt neue Zeitpläne innerhalb einer Minute.');
}

function liste(ziel) {
  console.log(`Ablage: ${ziel}`);
  for (const teil of ['sicherung', 'rezepte']) {
    const dir = path.join(ziel, teil);
    const dateien = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
    console.log(`\n${teil} (${dateien.length}):`);
    for (const f of dateien) console.log(`  ${f}`);
  }
}

const [befehl, ...rest] = process.argv.slice(2);
const ziel = privatDir();
try {
  if (befehl === 'sichern') sichern(ziel);
  else if (befehl === 'rezepte') rezepteSchreiben(ziel);
  else if (befehl === 'laden') laden(rest);
  else if (befehl === 'liste') liste(ziel);
  else { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 15).join('\n').replace(/^\/\/ ?/gm, '')); process.exit(befehl ? 1 : 0); }
} catch (e) { console.error(`✖ ${e.message}`); process.exit(1); }
