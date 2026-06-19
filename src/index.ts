import express from 'express';
import crypto from 'crypto';
import { config } from './core/config.js';
import { getTransport, listConfiguredTransports } from './transport/index.js';
import type { TransportId } from './transport/index.js';
import { routeIncomingMessage } from './core/router.js';
import { handleMessage, handleWelcome } from './core/handler.js';
import {
  getAllLeads, isMessageProcessed, cleanupProcessedMessages,
  purgeOldConversations, initDatabase, getDatabase,
} from './core/db.js';
import { handleControlCommand } from './core/admin.js';
import { initCrmBridge } from './core/crm-bridge.js';

const app = express();

// Pour la vérification HMAC Meta on a besoin du raw body. On capture le buffer brut.
app.use(express.json({
  limit: '256kb',
  verify: (req: express.Request & { rawBody?: string }, _res, buf) => {
    req.rawBody = buf.toString('utf8');
  },
}));

// --- Webhook verification (GET) — Meta uniquement ---
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

// Handler générique de webhook entrant — paramétré par transport
async function handleIncomingWebhook(
  transportId: TransportId,
  req: express.Request & { rawBody?: string },
  res: express.Response
): Promise<void> {
  res.sendStatus(200);

  const transport = getTransport(transportId);

  if (transport.verifyWebhookSignature && req.rawBody) {
    const ok = transport.verifyWebhookSignature(req.rawBody, req.headers as Record<string, string | string[] | undefined>);
    if (!ok) {
      console.warn(`[Webhook/${transportId}] Invalid HMAC signature, ignoring`);
      return;
    }
  }

  const message = transport.parseWebhookPayload(req.body);
  if (!message) return;

  console.log(`[Webhook/${transportId}] Incoming from ${message.phone} -> ${message.toNumber}: ${message.text.slice(0, 80)}`);

  if (await isMessageProcessed(message.messageId)) {
    console.log(`[Webhook/${transportId}] Duplicate ignored: ${message.messageId}`);
    return;
  }

  if (message.text === '[audio]') {
    transport.sendText(message.phone, 'Les messages vocaux ne sont pas encore supportés. Écrivez-moi votre réponse.').catch(() => {});
    return;
  }

  if (message.text === '[message non-texte]') {
    transport.sendText(message.phone, 'Je ne peux traiter que les messages texte. Écrivez-moi votre question.').catch(() => {});
    return;
  }

  const route = await routeIncomingMessage(message.phone, message.toNumber);
  if (!route) {
    console.warn(`[Webhook/${transportId}] No bot configured for ${message.toNumber}, ignoring`);
    return;
  }

  if (route.config.transport !== transportId) {
    console.warn(`[Webhook/${transportId}] Bot ${route.client_id}/${route.bot_id} expects transport=${route.config.transport}, but webhook came from ${transportId}. Ignoring.`);
    return;
  }

  const handled = await handleControlCommand(message.phone, message.text, route.client_id, route.bot_id).catch((err) => {
    console.error('[Admin] Command error:', err);
    return false;
  });
  if (handled) return;

  if (route.is_new_session && route.config.welcome.enabled) {
    withPhoneLock(message.phone, () =>
      handleWelcome(message.phone, route.config, message.messageId, message.profileName).catch((err) => {
        console.error('[Welcome] Error:', err);
      })
    );
    return;
  }

  withPhoneLock(message.phone, () =>
    handleMessage(message.phone, message.text, route.config, message.messageId, message.profileName).catch((err) => {
      console.error('[Webhook] Handler error:', err);
    })
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

// --- Dashboard (leads) - protege par API key ---
/** Comparaison constant-time (évite les timing attacks sur la clé). */
function safeKeyEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

app.get('/dashboard', async (req, res) => {
  const apiKey = config.dashboardApiKey;
  // Fail-closed : sans clé configurée, on ne sert pas les leads (pas d'accès anonyme).
  if (!apiKey) {
    console.error('[Dashboard] DASHBOARD_API_KEY non configuré, endpoint désactivé');
    res.sendStatus(503);
    return;
  }
  // Header prioritaire : la query string fuite dans les logs d'accès / le referer.
  const provided = (req.headers['x-api-key'] as string) || (req.query['key'] as string) || '';
  if (!provided || !safeKeyEqual(provided, apiKey)) {
    res.sendStatus(401);
    return;
  }
  const leads = await getAllLeads();
  res.json({ leads, count: leads.length });
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
  await cleanupProcessedMessages();
  await purgeOldConversations(90);

  const transports = listConfiguredTransports();
  console.log(`[Server] Configured transports: ${transports.join(', ') || '(none)'}`);

  initCrmBridge();

  app.listen(config.port, () => {
    console.log(`[Server] Cyran Labs Engine running on port ${config.port}`);
    console.log(`[Server] Webhook Meta: POST /webhook/meta`);
    console.log(`[Server] Webhook CM.com: POST /webhook/cm-com`);
    console.log(`[Server] Dashboard: GET /dashboard`);
  });
}

main().catch((err) => {
  console.error('[Server] Startup failed:', err);
  process.exit(1);
});
