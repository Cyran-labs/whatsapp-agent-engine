/**
 * Démarrage du moteur : base, configuration des agents IA, services, application HTTP, purges
 * périodiques et arrêt propre. Aucune logique de webhook ici (voir src/app.ts et src/webhooks/).
 */
import { config } from './core/config.js';
import { initDatabase, getDatabase } from './core/db.js';
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
import { WhatsAppAccountService } from './core/services/whatsapp-account-service.js';
import { createMailer, warnIfMailerNotConfigured } from './core/auth/mailer.js';
import { createInFlightTracker } from './core/in-flight.js';
import { startMaintenance } from './core/maintenance.js';
import { createShutdownHandler } from './core/shutdown.js';
import { createRefreshScheduler } from './whatsapp/refresh-scheduler.js';
import { createApp } from './app.js';

async function main(): Promise<void> {
  // Échec rapide : le serveur refuse de démarrer sans clé Anthropic (lue à l'appel, plus au chargement).
  void config.anthropic.apiKey;
  // Idem pour une adresse publique invalide (URL de webhook affichée aux admins).
  void config.webhook.publicBaseUrl;
  const db = await initDatabase();
  await initConfigStore();
  await initCrmBridge();

  const mailer = createMailer();
  warnIfMailerNotConfigured();
  const credentials = new CredentialsService({ db });
  const whatsappAccountService = new WhatsAppAccountService({ db });
  const adminRouter = createAdminRouter({
    db,
    authService: new AuthService({ db, mailer }),
    adminService: new AdminService({ db, mailer }),
    botService: new BotService({ db }),
    entityService: new EntityService({ db }),
    settingsService: new SettingsService({ db }),
    userAdminService: new UserAdminService({ db, mailer }),
    connectionsService: new ConnectionsService({ db, credentials }),
    dashboardService: new DashboardService({ db, credentials }),
    simulateService: new SimulateService({}),
    whatsappAccountService,
  });

  const tracker = createInFlightTracker();
  // Rafraîchissement d'inventaire sur événement Meta (au plus un par compte et par minute) : suivi par l'arrêt
  // propre ; le résultat est jeté, jamais journalisé (il peut nommer des agents IA). Jamais de reprise de numéro.
  const refreshScheduler = createRefreshScheduler((clientId, accountId) =>
    tracker.track(whatsappAccountService.refreshOnProviderEvent(clientId, accountId)).then(() => undefined));
  const app = createApp({ tracker, adminRouter, refreshScheduler });
  const server = app.listen(config.port, () => {
    console.log(`[Server] WABAGENT Engine running on port ${config.port}`);
    console.log('[Server] Webhook Meta: GET et POST /webhook/meta/:key (un par compte WhatsApp)');
    console.log('[Server] Webhook CM.com: POST /webhook/cm-com/:key (un par compte WhatsApp)');
    console.log('[Server] Admin API: /api/admin/v1');
  });
  // Purges tout de suite (elles remplacent celles du démarrage) puis toutes les 6 h (audit 6.6).
  const stopMaintenance = startMaintenance(db, { conversationDays: config.maintenance.conversationRetentionDays });

  const shutdown = createShutdownHandler({
    server,
    tracker,
    stopMaintenance: async () => {
      refreshScheduler.stop();
      await stopMaintenance();
    },
    closeDatabase: () => getDatabase().close(),
    timeoutMs: config.shutdownTimeoutMs,
    exit: (code) => process.exit(code),
  });
  // Un seul arrêt : un second signal pendant l'attente des traitements ne relance rien (audit 5.5).
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
}

main().catch((err) => {
  // Nom et pile seulement, jamais l'objet entier (voir src/api/middleware/error-handler.ts).
  const detail = err instanceof Error ? (err.stack ?? `${err.name}: ${err.message}`) : typeof err;
  console.error(`[Server] Startup failed: ${detail}`);
  process.exit(1);
});
