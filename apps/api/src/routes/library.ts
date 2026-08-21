import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { loadManifests, getManifest, loadBlueprints, getBlueprint, exportBundle, importBundle } from '../lib/library.js';

// Routen der Bausteinbibliothek: Manifeste (Tracking-Typen), Blueprints
// (Quellen) und Bundle-Im-/Export fürs Teilen.
export const libraryRouter = Router();

libraryRouter.get('/api/manifests', asyncHandler(async (_req, res) => {
  res.json(loadManifests());
}));

libraryRouter.get('/api/manifests/:id', asyncHandler(async (req, res) => {
  const m = getManifest(req.params.id);
  if (!m) return res.status(404).json({ error: 'Manifest not found' });
  res.json(m);
}));

// Blueprints, optional per ?manifest_id= gefiltert.
libraryRouter.get('/api/blueprints', asyncHandler(async (req, res) => {
  res.json(loadBlueprints(req.query.manifest_id as string | undefined));
}));

libraryRouter.get('/api/blueprints/:id', asyncHandler(async (req, res) => {
  const b = getBlueprint(req.params.id);
  if (!b) return res.status(404).json({ error: 'Blueprint not found' });
  res.json(b);
}));

// Export: ?manifests=a,b&blueprints=x,y  (leer = alles).
libraryRouter.get('/api/library/export', asyncHandler(async (req, res) => {
  const split = (v: unknown) => (typeof v === 'string' && v.length) ? v.split(',') : undefined;
  const bundle = exportBundle({
    manifestIds: split(req.query.manifests),
    blueprintIds: split(req.query.blueprints),
  });
  res.setHeader('Content-Disposition', 'attachment; filename="checky-bundle.json"');
  res.json(bundle);
}));

// Import: Bundle-JSON im Body -> schreibt Bausteine in die Bibliothek.
libraryRouter.post('/api/library/import', asyncHandler(async (req, res) => {
  try {
    const written = importBundle(req.body);
    res.status(201).json({ ok: true, imported: written });
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
}));
