import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

// Wrappt async-Route-Handler, damit geworfene Fehler an die zentrale
// Error-Middleware in app.ts gehen (kein try/catch pro Route nötig).
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// Wiederkehrende Param-/Query-Validierung, projektweit geteilt.
export const IdParamSchema = z.object({ id: z.string().uuid() });
export const SidParamSchema = z.object({ sid: z.string().uuid() });
export const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
