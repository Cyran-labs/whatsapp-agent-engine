import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../../core/auth/tokens.js';
import { unauthorized, forbidden } from '../errors.js';

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers['authorization'];
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) { next(unauthorized()); return; }
  void verifyAccessToken(token).then((claims) => {
    if (!claims) { next(unauthorized()); return; }
    req.auth = { userId: Number(claims.sub), role: claims.role, clientId: claims.client_id };
    next();
  }).catch(() => next(unauthorized()));
}

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth || !roles.includes(req.auth.role)) { next(forbidden()); return; }
    next();
  };
}

export function scopeToClient(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) { next(forbidden()); return; }
  if (req.auth.role === 'super_admin') {
    const q = req.query['client_id'];
    if (typeof q === 'string' && q) req.scopedClientId = q;
    next();
    return;
  }
  // client_admin : scope forcé sur son propre client (anti-escalade)
  if (!req.auth.clientId) { next(forbidden()); return; }
  req.scopedClientId = req.auth.clientId;
  next();
}
