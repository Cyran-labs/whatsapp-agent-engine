import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { SimulateService } from '../../../core/services/simulate-service.js';
import { SimulateInput } from '@wabagent/contracts';
import { activeClientId, requireAction } from '../../middleware/auth.js';

export function simulateRoutes(svc: SimulateService, wrap: (fn: RequestHandler) => RequestHandler): Router {
  const r = Router({ mergeParams: true });
  r.post('/simulate', requireAction('simulate.use'), wrap(async (req, res) => {
    const body = SimulateInput.parse(req.body);
    res.json(await svc.simulate(activeClientId(req), String(req.params['botId']), body));
  }));
  return r;
}
