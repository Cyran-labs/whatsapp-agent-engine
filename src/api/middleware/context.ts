import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import type { Access } from '../../core/auth/permissions.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      /** Identité du jeton : le rôle est indicatif, les droits sont relus en base. */
      auth?: { userId: number; role: string };
      scopedClientId?: string;
      /** Droits résolus en base par `createRequireOrganization`. */
      access?: Access;
    }
  }
}

export function requestId(req: Request, _res: Response, next: NextFunction): void {
  req.requestId = crypto.randomUUID();
  next();
}

/**
 * Aucune réponse de l'API d'administration ne se met en cache : elles portent des données d'organisation, des
 * jetons ou des clés d'URL de webhook, et dépendent de l'en-tête d'organisation. Posé en tête du routeur, avant
 * toute réponse : succès, refus, authentification, route inconnue et préflight (revue 2b-3, défense en profondeur).
 */
export function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

/** CORS restreint à l'origine du back-office web. */
export function cors(origin: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Organization-Id');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  };
}

export {};
