import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { DashboardService } from '../../../core/services/dashboard-service.js';
import { activeClientId, requireAction } from '../../middleware/auth.js';
import { LeadsQuery, UsageQuery } from '@wabagent/contracts';

export function dashboardRoutes(svc: DashboardService, wrap: (fn: RequestHandler) => RequestHandler): Router {
  const r = Router({ mergeParams: true });

  r.get('/health', requireAction('org.read'), wrap(async (req, res) => {
    res.json(await svc.health(activeClientId(req), String(req.params['botId'])));
  }));

  r.get('/leads', requireAction('org.read'), wrap(async (req, res) => {
    const q = LeadsQuery.parse(req.query);
    res.json(await svc.listLeads(activeClientId(req), String(req.params['botId']), q));
  }));

  r.get('/leads/:phone', requireAction('org.read'), wrap(async (req, res) => {
    res.json(await svc.getLead(activeClientId(req), String(req.params['botId']), String(req.params['phone'])));
  }));

  r.get('/metrics', requireAction('org.read'), wrap(async (req, res) => {
    res.json(await svc.metrics(activeClientId(req), String(req.params['botId'])));
  }));

  // Coûts réservés à l'admin (spec refonte de la navigation, 9.1) : le droit est contrôlé avant toute lecture de l'agent
  // IA, un non-admin reçoit le même 403 pour un agent IA de son organisation, inconnu ou d'une autre organisation.
  r.get('/usage', requireAction('usage.read'), wrap(async (req, res) => {
    // Instant ISO UTC canonique (revue finale M-10) : une valeur invalide est un 400 sur `since`, jamais une erreur de base.
    const { since } = UsageQuery.parse({ since: req.query['since'] });
    res.json(await svc.usage(activeClientId(req), String(req.params['botId']), since ?? new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()));
  }));

  return r;
}
