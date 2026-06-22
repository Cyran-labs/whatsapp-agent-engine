/**
 * simulateRoutes — squelette minimal (Task 3).
 * Task 6 étoffettera la logique complète.
 */
import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { SimulateService } from '../../../core/services/simulate-service.js';

export function simulateRoutes(_svc: SimulateService, _wrap: (fn: RequestHandler) => RequestHandler): Router {
  const r = Router({ mergeParams: true });
  // Routes à compléter en Task 6
  return r;
}
