import { Router } from 'express';
import type { Request, RequestHandler } from 'express';
import type { DashboardService } from '../../../core/services/dashboard-service.js';
import { forbidden } from '../../errors.js';

function requireScopedClient(req: Request): string {
  if (!req.scopedClientId) throw forbidden('client_id requis (super_admin : préciser ?client_id).');
  return req.scopedClientId;
}

export function dashboardRoutes(svc: DashboardService, wrap: (fn: RequestHandler) => RequestHandler): Router {
  const r = Router({ mergeParams: true });

  r.get('/health', wrap(async (req, res) => {
    res.json(await svc.health(requireScopedClient(req), String(req.params['botId'])));
  }));

  return r;
}
