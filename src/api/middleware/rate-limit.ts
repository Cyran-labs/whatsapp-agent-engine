import type { Request, Response, NextFunction } from 'express';
import { rateLimited } from '../errors.js';

interface Bucket { count: number; resetAt: number; }

/**
 * Limiteur fixed-window en mémoire (mono-instance). Pour un déploiement
 * multi-instance, remplacer le store par Redis (item futur).
 *
 * Les buckets périmés sont purgés paresseusement (au plus une fenêtre après
 * leur expiration) pour borner la mémoire : sans cela, chaque couple
 * `ip:path` vu resterait indéfiniment dans la Map.
 */
export function createRateLimiter(opts: { windowMs: number; max: number }) {
  const buckets = new Map<string, Bucket>();
  let lastSweep = 0;

  function sweepExpired(now: number): void {
    for (const [k, b] of buckets) {
      if (now >= b.resetAt) buckets.delete(k);
    }
    lastSweep = now;
  }

  return (req: Request, _res: Response, next: NextFunction): void => {
    const now = Date.now();
    if (now - lastSweep >= opts.windowMs) sweepExpired(now);
    const key = `${req.ip}:${req.path}`;
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
