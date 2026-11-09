/**
 * Application HTTP du moteur : webhooks authentifiés, santé, routeur d'administration.
 * Aucun service n'est construit ici (voir src/index.ts) : les tests montent l'application telle quelle.
 */
import express from 'express';
import type { InFlightTracker } from './core/in-flight.js';
import { createMetaWebhookRouter } from './webhooks/meta.js';
import { createCmWebhookRouter } from './webhooks/cm-com.js';
import type { RefreshScheduler } from './whatsapp/refresh-scheduler.js';

export interface AppDeps {
  tracker: InFlightTracker;
  adminRouter?: express.Router;
  /** Rafraîchit l'inventaire d'un compte WhatsApp sur événement Meta ; absent : les événements ne déclenchent rien. */
  refreshScheduler?: RefreshScheduler;
}

/** Erreur levée par express.json (corps illisible, trop gros) : seul son type est journalisé, jamais le corps. */
interface BodyParserError { type?: unknown; status?: unknown }

function isBodyParserError(err: unknown): err is BodyParserError {
  return typeof err === 'object' && err !== null && 'type' in err && typeof (err as BodyParserError).type === 'string';
}

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.disable('x-powered-by');

  // Les routes de webhook, une par compte WhatsApp (clé d'URL), lisent leur corps elles-mêmes après avoir
  // identifié le compte (src/webhooks/raw-body.ts) ; le routeur d'administration a son propre analyseur.
  app.use(createMetaWebhookRouter(deps.tracker, deps.refreshScheduler));
  app.use(createCmWebhookRouter(deps.tracker));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  if (deps.adminRouter) app.use('/api/admin/v1', deps.adminRouter);

  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) { next(err); return; }
    if (isBodyParserError(err)) {
      const status = typeof err.status === 'number' && err.status >= 400 && err.status < 500 ? err.status : 400;
      console.warn(`[App] Corps de requête refusé (${String(err.type)})`);
      res.sendStatus(status);
      return;
    }
    console.error('[App] Erreur non gérée:', err instanceof Error ? err.message : String(err));
    res.sendStatus(500);
  });

  return app;
}
