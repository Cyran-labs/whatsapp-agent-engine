import express from 'express';
import { config } from './core/config.js';
import { getTransportForBot } from './transport/index.js';
import type { TransportId } from './transport/index.js';
import { parseMetaWebhookPayload } from './transport/meta-cloud.js';
import { parseCmWebhookPayload } from './transport/cm-com.js';
import { routeIncomingMessage } from './core/router.js';
import { normalizeWhatsAppNumber } from './core/phone.js';
import { handleMessage, handleWelcome } from './core/handler.js';
import {
  claimMessage, completeMessage, cleanupProcessedMessages,
  purgeOldConversations, initDatabase, getDatabase, createSessionIfAbsent, touchSession,
} from './core/db.js';
import { initCrmBridge } from './core/crm-bridge.js';
import { initConfigStore } from './core/config-store.js';
import { createAdminRouter } from './api/admin/router.js';
import { AuthService } from './core/auth/auth-service.js';
import { AdminService } from './core/auth/admin-service.js';
import { BotService } from './core/services/bot-service.js';
import { EntityService } from './core/services/entity-service.js';
import { SettingsService } from './core/services/settings-service.js';
import { UserAdminService } from './core/services/user-admin-service.js';
import { CredentialsService } from './core/services/credentials-service.js';
import { ConnectionsService } from './core/services/connections-service.js';
import { DashboardService } from './core/services/dashboard-service.js';
import { SimulateService } from './core/services/simulate-service.js';
import { createMailer } from './core/auth/mailer.js';

const app = express();

// Pour la vérification HMAC Meta on a besoin du raw body. On capture le buffer brut.
app.use(express.json({
  limit: '256kb',
  verify: (req: express.Request & { rawBody?: string }, _res, buf) => {
    req.rawBody = buf.toString('utf8');
  },
}));

// --- Webhook verification (GET): Meta uniquement ---
app.get('/webhook/meta', (req, res) => {
  const mode = req.query['hub.mode'] as string;
  const token = req.query['hub.verify_token'] as string;
  const challenge = req.query['hub.challenge'] as string;

  if (mode === 'subscribe' && token === config.meta.verifyToken) {
    console.log('[Webhook/Meta] Verification OK');
    res.status(200).send(challenge);
  } else {
    console.warn(`[Webhook/Meta] Verification failed (mode=${mode}, token match=${token === config.meta.verifyToken})`);
    res.sendStatus(403);
  }
});

// CM.com n'a pas de verification GET, mais on garde l'endpoint pour compat
app.get('/webhook/cm-com', (_req, res) => res.sendStatus(200));

// Phone mutex: serialize messages per phone number
const phoneLocks = new Map<string, Promise<void>>();

function withPhoneLock(phone: string, fn: () => Promise<void>): void {
  const prev = phoneLocks.get(phone) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  phoneLocks.set(phone, next);
  next.finally(() => {
    if (phoneLocks.get(phone) === next) {
      phoneLocks.delete(phone);
    }
  });
}

// Marque le message terminé ; une erreur de base ne doit jamais remonter (le message reste repris après le délai).
async function completeQuietly(messageId: string): Promise<void> {
  try {
    await completeMessage(messageId);
  } catch (err) {
    console.error('[Webhook] completeMessage failed:', err instanceof Error ? err.message : err);
  }
}

// Handler générique de webhook entrant: paramétré par transport
async function handleIncomingWebhook(
  transportId: TransportId,
  req: express.Request & { rawBody?: string },
  res: express.Response
): Promise<void> {
  res.sendStatus(200);

  // Parse de structure (sans secret) pour obtenir le numéro destinataire et router.
  const message = transportId === 'cm-com' ? parseCmWebhookPayload(req.body) : parseMetaWebhookPayload(req.body);
  if (!message) return;

  const route = await routeIncomingMessage(message.phone, message.toNumber);
  if (!route) {
    console.warn(`[Webhook/${transportId}] No bot configured for ${message.toNumber}, ignoring`);
    return;
  }

  if (route.config.transport !== transportId) {
    console.warn(`[Webhook/${transportId}] Bot ${route.client_id}/${route.bot_id} expects transport=${route.config.transport}, but webhook came from ${transportId}. Ignoring.`);
    return;
  }

  // Transport du bot (app_secret par tenant) -> vérification HMAC.
  const transport = await getTransportForBot(route.config);
  if (!transport) {
    // Aucun repli sur la plateforme : sans identifiants complets, on ne vérifie ni ne répond.
    console.warn(`[Webhook/${transportId}] No complete transport credentials for ${route.client_id}/${route.bot_id}, ignoring`);
    return;
  }
  if (transport.verifyWebhookSignature && req.rawBody) {
    const ok = transport.verifyWebhookSignature(req.rawBody, req.headers as Record<string, string | string[] | undefined>);
    if (!ok) {
      console.warn(`[Webhook/${transportId}] Invalid HMAC signature, ignoring`);
      return;
    }
  }

  // Persistance de la session APRÈS la vérif HMAC : un payload non signé ne doit
  // pas pouvoir créer ou réassigner une session (le routage ci-dessus est lecture seule).
  const waNumber = normalizeWhatsAppNumber(message.toNumber);
  if (waNumber === null) {
    console.warn(`[Webhook/${transportId}] Destination number is not a valid E.164 number, ignoring`);
    return;
  }
  const isNewSession = await createSessionIfAbsent(waNumber, message.phone, route.client_id, route.bot_id);
  if (isNewSession) {
    console.log(`[Router] New session: ${message.phone} -> ${route.client_id}/${route.bot_id}`);
  } else {
    await touchSession(waNumber, message.phone);
  }

  console.log(`[Webhook/${transportId}] Incoming from ${message.phone} -> ${message.toNumber}: ${message.text.slice(0, 80)}`);

  if (!(await claimMessage(message.messageId, 300))) {
    console.log(`[Webhook/${transportId}] Duplicate ignored: ${message.messageId}`);
    return;
  }

  if (message.text === '[audio]') {
    transport.sendText(message.phone, 'Les messages vocaux ne sont pas encore supportés. Écrivez-moi votre réponse.').catch(() => {});
    await completeQuietly(message.messageId);
    return;
  }

  if (message.text === '[message non-texte]') {
    transport.sendText(message.phone, 'Je ne peux traiter que les messages texte. Écrivez-moi votre question.').catch(() => {});
    await completeQuietly(message.messageId);
    return;
  }

  if (isNewSession && route.config.welcome.enabled) {
    withPhoneLock(message.phone, () =>
      handleWelcome(message.phone, route.config, message.messageId, message.profileName).catch((err) => {
        console.error('[Welcome] Error:', err);
      }).finally(() => completeQuietly(message.messageId))
    );
    return;
  }

  withPhoneLock(message.phone, () =>
    handleMessage(message.phone, message.text, route.config, message.messageId, message.profileName).catch((err) => {
      console.error('[Webhook] Handler error:', err);
    }).finally(() => completeQuietly(message.messageId))
  );
}

// Routes par transport
app.post('/webhook/meta', (req, res) => {
  handleIncomingWebhook('meta-cloud', req as express.Request & { rawBody?: string }, res).catch((err) => {
    console.error('[Webhook/Meta] Unhandled error:', err);
  });
});

app.post('/webhook/cm-com', (req, res) => {
  handleIncomingWebhook('cm-com', req as express.Request & { rawBody?: string }, res).catch((err) => {
    console.error('[Webhook/CmCom] Unhandled error:', err);
  });
});

// Compat avec l'ancien path /webhook (utilisé par CM.com en prod whatsapp-cyran-bot)
app.post('/webhook', (req, res) => {
  handleIncomingWebhook('cm-com', req as express.Request & { rawBody?: string }, res).catch((err) => {
    console.error('[Webhook] Unhandled error:', err);
  });
});
app.get('/webhook', (req, res) => {
  // Meta verification fallback sur le path legacy
  const mode = req.query['hub.mode'] as string;
  const token = req.query['hub.verify_token'] as string;
  const challenge = req.query['hub.challenge'] as string;
  if (mode === 'subscribe' && token === config.meta.verifyToken) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(200);
  }
});

// --- Health check ---
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- Graceful shutdown ---
function shutdown() {
  console.log('[Server] Shutting down...');
  getDatabase().close().then(() => process.exit(0)).catch(() => process.exit(1));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// --- Startup ---
async function main() {
  await initDatabase();
  await initConfigStore();
  await cleanupProcessedMessages();
  await purgeOldConversations(90);

  await initCrmBridge();

  const mailer = createMailer();
  const adminDb = getDatabase();
  const authService = new AuthService({ db: adminDb, mailer });
  const adminService = new AdminService({ db: adminDb, mailer });
  const botService = new BotService({ db: adminDb });
  const entityService = new EntityService({ db: adminDb });
  const settingsService = new SettingsService({ db: adminDb });
  const userAdminService = new UserAdminService({ db: adminDb, mailer });
  const credentials = new CredentialsService({ db: adminDb });
  const connectionsService = new ConnectionsService({ db: adminDb, credentials });
  const dashboardService = new DashboardService({ db: adminDb, credentials });
  const simulateService = new SimulateService({});
  app.use('/api/admin/v1', createAdminRouter({ db: adminDb, authService, adminService, botService, entityService, settingsService, userAdminService, connectionsService, dashboardService, simulateService }));

  app.listen(config.port, () => {
    console.log(`[Server] WABAGENT Engine running on port ${config.port}`);
    console.log(`[Server] Webhook Meta: POST /webhook/meta`);
    console.log(`[Server] Webhook CM.com: POST /webhook/cm-com`);
    console.log(`[Server] Admin API: /api/admin/v1`);
  });
}

main().catch((err) => {
  console.error('[Server] Startup failed:', err);
  process.exit(1);
});
