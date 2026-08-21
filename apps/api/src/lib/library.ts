import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// --- Bausteinbibliothek ------------------------------------------------------
// Zwei dateibasierte, git-versionierte Ebenen, die ineinandergreifen:
//   manifests/*.json   Tracking-Typen  (WAS: Parameter, Ergebnis-Darstellung)
//   blueprints/*.json  Quellen         (WO:  site, goal_template, Zeitplan)
// Beide liegen als schlichte JSON-Dateien vor, damit Nutzer/Community sie
// hinzufügen, teilen und per Bundle im-/exportieren können.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '../../../..'); // apps/api/src/lib -> Repo-Wurzel

export const MANIFESTS_DIR = process.env.MANIFESTS_DIR || path.join(ROOT, 'manifests');
export const BLUEPRINTS_DIR = process.env.BLUEPRINTS_DIR || path.join(ROOT, 'blueprints');

function readJsonDir(dir: string): any[] {
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')); }
        catch (e) { console.error(`[library] ${f} nicht lesbar:`, e); return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function loadManifests(): any[] {
  return readJsonDir(MANIFESTS_DIR).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

export function getManifest(id: string): any | undefined {
  return loadManifests().find(m => m.id === id);
}

export function loadBlueprints(manifestId?: string): any[] {
  let bps = readJsonDir(BLUEPRINTS_DIR);
  if (manifestId) bps = bps.filter(b => b.manifest_id === manifestId);
  return bps.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

export function getBlueprint(id: string): any | undefined {
  return loadBlueprints().find(b => b.id === id);
}

// --- Bundle (Import/Export) --------------------------------------------------
// Ein Bundle bündelt beliebige Bausteine in EINER Datei, die man weitergeben
// oder aus einem Community-Repo einspielen kann.
export interface CheckyBundle {
  kind: 'checky-bundle';
  version: 1;
  manifests?: any[];
  blueprints?: any[];
  recipes?: any[];
}

export function exportBundle(opts: { manifestIds?: string[]; blueprintIds?: string[] }): CheckyBundle {
  const manifests = loadManifests().filter(m => !opts.manifestIds || opts.manifestIds.includes(m.id));
  const blueprints = loadBlueprints().filter(b => !opts.blueprintIds || opts.blueprintIds.includes(b.id));
  return { kind: 'checky-bundle', version: 1, manifests, blueprints };
}

const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;

// Schreibt die Bausteine eines Bundles als einzelne Dateien in die Bibliothek.
// Gibt zurück, was importiert wurde. id wird als Dateiname genutzt und streng
// validiert, damit kein Pfad ausbrechen kann.
export function importBundle(bundle: CheckyBundle): { manifests: string[]; blueprints: string[] } {
  if (bundle?.kind !== 'checky-bundle') throw new Error('Kein gültiges Checky-Bundle.');
  const written = { manifests: [] as string[], blueprints: [] as string[] };

  const writeInto = (dir: string, items: any[] | undefined, bucket: string[]) => {
    if (!items?.length) return;
    fs.mkdirSync(dir, { recursive: true });
    for (const item of items) {
      const id = String(item?.id || '');
      if (!SLUG.test(id)) throw new Error(`Ungültige id "${id}" – nur a-z, 0-9, _ und - erlaubt.`);
      fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(item, null, 2));
      bucket.push(id);
    }
  };

  writeInto(MANIFESTS_DIR, bundle.manifests, written.manifests);
  writeInto(BLUEPRINTS_DIR, bundle.blueprints, written.blueprints);
  return written;
}
