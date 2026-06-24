import { Router } from 'express';
import type { Request, RequestHandler } from 'express';
import type { SimulateService } from '../../../core/services/simulate-service.js';
import { SimulateInput } from '@wabagent/contracts';
import { forbidden } from '../../errors.js';

function requireScopedClient(req: Request): string {
  if (!req.scopedClientId) throw forbidden('client_id requis (super_admin : préciser ?client_id).');
  return req.scopedClientId;
}

export function simulateRoutes(svc: SimulateService, wrap: (fn: RequestHandler) => RequestHandler): Router {
  const r = Router({ mergeParams: true });
  r.post('/simulate', wrap(async (req, res) => {
    const body = SimulateInput.parse(req.body);
    res.json(await svc.simulate(requireScopedClient(req), String(req.params['botId']), body));
  }));
  return r;
}
