import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { verifyAccessToken } from '../../core/auth/tokens.js';
import { resolveAccess, ORGANIZATION_HEADER } from '../../core/auth/access-service.js';
import { can, type Action } from '../../core/auth/permissions.js';
import type { Database } from '../../core/database/types.js';
import { unauthorized, forbidden } from '../errors.js';

const PLATFORM_ADMIN_ROLE = 'super_admin';

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers['authorization'];
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) { next(unauthorized()); return; }
  void verifyAccessToken(token).then((claims) => {
    if (!claims) { next(unauthorized()); return; }
    const userId = Number(claims.sub);
    if (!Number.isSafeInteger(userId) || userId <= 0) { next(unauthorized()); return; }
    req.auth = { userId, role: claims.role };
    next();
  }).catch(() => next(unauthorized()));
}

/**
 * Réservé au super admin plateforme. Le rôle est relu en base à chaque requête : le rôle
 * du jeton n'est jamais cru. Utilisateur absent ou non actif : 401 ; autre rôle : 403.
 */
export function createRequirePlatformAdmin(db: Database): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) { next(unauthorized()); return; }
    void db.getUserById(req.auth.userId).then((user) => {
      if (!user || user.status !== 'active') { next(unauthorized()); return; }
      if (user.role !== PLATFORM_ADMIN_ROLE) { next(forbidden()); return; }
      next();
    }).catch((err: unknown) => next(err));
  };
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

/** Organisation active de la requête, posée par `createRequireOrganization` ; sans elle, refuse (fail closed). */
export function activeClientId(req: Request): string {
  if (!req.scopedClientId) throw forbidden();
  return req.scopedClientId;
}
