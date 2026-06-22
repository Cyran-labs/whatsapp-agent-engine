import express, { Router } from 'express';
import type { RequestHandler } from 'express';
import type { Database } from '../../core/database/types.js';
import type { AuthService } from '../../core/auth/auth-service.js';
import type { AdminService } from '../../core/auth/admin-service.js';
import type { BotService } from '../../core/services/bot-service.js';
import type { ConnectionsService } from '../../core/services/connections-service.js';
import type { DashboardService } from '../../core/services/dashboard-service.js';
import type { SimulateService } from '../../core/services/simulate-service.js';
import { config } from '../../core/config.js';
import { cors, requestId } from '../middleware/context.js';
import { errorHandler, notFoundHandler } from '../middleware/error-handler.js';
import { requireAuth, scopeToClient } from '../middleware/auth.js';
import { authRoutes } from './routes/auth.js';
import { clientsRoutes } from './routes/clients.js';
import { botsRoutes } from './routes/bots.js';
import { connectionsRoutes } from './routes/connections.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { simulateRoutes } from './routes/simulate.js';
import { connectorsCatalogue } from '../../core/providers.js';

export interface AdminRouterDeps {
  db: Database;
  authService: AuthService;
  adminService: AdminService;
  botService: BotService;
  connectionsService: ConnectionsService;
  dashboardService: DashboardService;
  simulateService: SimulateService;
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
  r.use('/bots', botsRoutes(deps.botService, wrap));

  r.get('/connectors', requireAuth, wrap(async (_req, res) => { res.json(connectorsCatalogue()); }));
  r.use('/bots/:botId', requireAuth, scopeToClient, connectionsRoutes(deps.connectionsService, wrap));
  r.use('/bots/:botId', requireAuth, scopeToClient, dashboardRoutes(deps.dashboardService, wrap));
  r.use('/bots/:botId', requireAuth, scopeToClient, simulateRoutes(deps.simulateService, wrap));

  r.use(notFoundHandler);
  r.use(errorHandler);
  return r;
}
