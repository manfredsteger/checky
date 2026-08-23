import express, { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { projectsRouter } from './routes/projects.js';
import { agentsRouter } from './routes/agents.js';
import { runsRouter } from './routes/runs.js';
import { recorderRouter } from './routes/recorder.js';
import { libraryRouter } from './routes/library.js';
import { settingsRouter } from './routes/settings.js';
import { placesRouter } from './routes/places.js';

// Kompositions-Wurzel: nur App-Setup + Router-Montage + zentrale Fehler-
// behandlung. Die eigentliche Logik liegt modular in routes/ und lib/.
export const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'checky-api', timestamp: new Date().toISOString() });
});

app.use(projectsRouter);
app.use(agentsRouter);
app.use(runsRouter);
app.use(recorderRouter);
app.use(libraryRouter);
app.use(settingsRouter);
app.use(placesRouter);

// Zentrale Fehlerbehandlung für alle Router.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError) {
    return res.status(400).json({ error: 'Validation error: ' + (err as any).issues.map((e: any) => `${e.path.join('.')}: ${e.message}`).join(', ') });
  }
  console.error('[API Error]', err);
  if (err.message?.includes('Database is disabled')) {
    return res.status(503).json({ error: err.message });
  }
  res.status(500).json({ error: 'Internal Server Error' });
});
