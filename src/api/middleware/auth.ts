import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { verifyAccessToken } from '../../core/auth/tokens.js';
import { resolveAccess, ORGANIZATION_HEADER } from '../../core/auth/access-service.js';
import { can, type Action } from '../../core/auth/permissions.js';
import type { Database } from '../../core/database/types.js';
import { unauthorized, forbidden } from '../errors.js';

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers['authorization'];
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) { next(unauthorized()); return; }
  void verifyAccessToken(token).then((claims) => {
    if (!claims) { next(unauthorized()); return; }
    const userId = Number(claims.sub);
    if (!Number.isSafeInteger(userId) || userId <= 0) { next(unauthorized()); return; }
    req.auth = { userId, role: claims.role, clientId: claims.legacy_client_id };
    next();
  }).catch(() => next(unauthorized()));
}

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth || !roles.includes(req.auth.role)) { next(forbidden()); return; }
    next();
  };
}

/**
 * Hérité, supprimé au recâblage des routes (tâche 6) : scope tiré du rôle et du
 * client_id du jeton. Remplacé par `createRequireOrganization`.
 */
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

/** Organisation demandée par l'en-tête ; absente ou vide : null (repli mono-organisation). */
function requestedOrganization(req: Request): string | null {
  const raw = req.get(ORGANIZATION_HEADER);
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value === '' ? null : value;
}

/**
 * Résout l'organisation active et les droits en base à chaque requête (aucun cache).
 * Pose `req.access` et `req.scopedClientId`. À monter après `requireAuth`.
 */
export function createRequireOrganization(db: Database): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) { next(unauthorized()); return; }
    void resolveAccess(db, req.auth.userId, requestedOrganization(req)).then((access) => {
      req.access = access;
      req.scopedClientId = access.clientId;
      next();
    }).catch((err: unknown) => next(err));
  };
}

/** Refuse (403) si les droits résolus ne permettent pas l'action ; sans droits résolus, refuse. */
export function requireAction(action: Action): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.access || !can(req.access, action)) { next(forbidden()); return; }
    next();
  };
}
