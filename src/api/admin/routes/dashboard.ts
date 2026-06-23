import { Router } from 'express';
import type { Request, RequestHandler } from 'express';
import type { DashboardService } from '../../../core/services/dashboard-service.js';
import { forbidden } from '../../errors.js';
import { LeadsQuery } from '../../../contracts/index.js';

function requireScopedClient(req: Request): string {
  if (!req.scopedClientId) throw forbidden('client_id requis (super_admin : préciser ?client_id).');
  return req.scopedClientId;
}

export function dashboardRoutes(svc: DashboardService, wrap: (fn: RequestHandler) => RequestHandler): Router {
  const r = Router({ mergeParams: true });

  r.get('/health', wrap(async (req, res) => {
    res.json(await svc.health(requireScopedClient(req), String(req.params['botId'])));
  }));

  r.get('/leads', wrap(async (req, res) => {
    const q = LeadsQuery.parse(req.query);
    res.json(await svc.listLeads(requireScopedClient(req), String(req.params['botId']), q));
  }));

  r.get('/leads/:phone', wrap(async (req, res) => {
    res.json(await svc.getLead(requireScopedClient(req), String(req.params['botId']), String(req.params['phone'])));
  }));

  return r;
}
