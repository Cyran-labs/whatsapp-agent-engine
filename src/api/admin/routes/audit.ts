import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { Database } from '../../../core/database/types.js';
import { activeClientId, requireAction } from '../../middleware/auth.js';

export function auditRoutes(db: Database, wrap: (fn: RequestHandler) => RequestHandler): Router {
  const r = Router();
  r.get('/', requireAction('audit.read'), wrap(async (req, res) => {
    res.json(await db.listAuditLog(activeClientId(req), 100));
  }));
  return r;
}
