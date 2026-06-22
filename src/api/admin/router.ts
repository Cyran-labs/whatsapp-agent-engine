import express, { Router } from 'express';
import type { RequestHandler } from 'express';
import type { Database } from '../../core/database/types.js';
import type { AuthService } from '../../core/auth/auth-service.js';
import type { AdminService } from '../../core/auth/admin-service.js';
import { config } from '../../core/config.js';
import { cors, requestId } from '../middleware/context.js';
import { errorHandler, notFoundHandler } from '../middleware/error-handler.js';
import { authRoutes } from './routes/auth.js';
import { clientsRoutes } from './routes/clients.js';

export interface AdminRouterDeps {
  db: Database;
  authService: AuthService;
  adminService: AdminService;
}

/** Enveloppe un handler async pour propager les rejets vers errorHandler. */
const wrap = (fn: RequestHandler): RequestHandler => (req, res, next) => {
  void Promise.resolve(fn(req, res, next)).catch(next);
};

export function createAdminRouter(deps: AdminRouterDeps): Router {
  const r = Router();
  r.use(cors(config.auth.webOrigin));
  r.use(express.json({ limit: '256kb' }));
  r.use(requestId);

  r.use('/auth', authRoutes(deps.authService, wrap));
  r.use('/clients', clientsRoutes(deps.adminService, wrap));

  r.use(notFoundHandler);
  r.use(errorHandler);
  return r;
}
