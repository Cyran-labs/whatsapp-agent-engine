import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import type { Access } from '../../core/auth/permissions.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      /** `clientId` : client_id hérité du jeton, lu seulement par `scopeToClient` (supprimé en tâche 6). */
      auth?: { userId: number; role: string; clientId: string | null };
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
