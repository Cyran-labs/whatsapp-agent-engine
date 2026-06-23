import { Router } from 'express';
import type { Request, RequestHandler } from 'express';
import type { Database } from '../../../core/database/types.js';
import { forbidden } from '../../errors.js';

function requireScopedClient(req: Request): string {
  if (!req.scopedClientId) throw forbidden('client_id requis (super_admin : préciser ?client_id).');
  return req.scopedClientId;
}

export function auditRoutes(db: Database, wrap: (fn: RequestHandler) => RequestHandler): Router {
  const r = Router();
  r.get('/', wrap(async (req, res) => {
    res.json(await db.listAuditLog(requireScopedClient(req), 100));
  }));
  return r;
}
