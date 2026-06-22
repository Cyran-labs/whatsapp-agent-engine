import type { Request, Response, NextFunction } from 'express';
import { rateLimited } from '../errors.js';

interface Bucket { count: number; resetAt: number; }

/**
 * Limiteur fixed-window en mémoire (mono-instance). Pour un déploiement
 * multi-instance, remplacer le store par Redis (item futur).
 */
export function createRateLimiter(opts: { windowMs: number; max: number }) {
  const buckets = new Map<string, Bucket>();
  return (req: Request, _res: Response, next: NextFunction): void => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const b = buckets.get(key);
    if (!b || now >= b.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }
    if (b.count >= opts.max) { next(rateLimited()); return; }
    b.count += 1;
    next();
  };
}
