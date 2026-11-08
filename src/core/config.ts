import 'dotenv/config';

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`[Config] Missing env var: ${key}`);
  return val;
}

/** Entier strictement positif lu dans l'environnement, valeur par défaut si absent ou invalide. */
function positiveInt(key: string, fallback: number): number {
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  meta: {
    // Seul réglage Meta global en 2b-1 : jeton du GET de vérification (par compte en 2b-2).
    get verifyToken(): string { return process.env['META_VERIFY_TOKEN'] || ''; },
    // Version de l'API Graph utilisée pour tous les appels Meta (audit 5.14).
    get graphVersion(): string { return process.env['META_GRAPH_VERSION'] || 'v26.0'; },
  },
  anthropic: {
    // Lue à l'appel et non au chargement du module : importer config ne doit pas exiger la clé.
    // Le démarrage du serveur la lit explicitement (src/index.ts, main) pour échouer vite.
    get apiKey(): string { return required('ANTHROPIC_API_KEY'); },
  },
  llm: {
    get clientConcurrency(): number {
      return parseInt(process.env['LLM_CLIENT_CONCURRENCY'] || '3', 10);
    },
    get keyCooldownMs(): number {
      return parseInt(process.env['LLM_KEY_COOLDOWN_MS'] || '30000', 10);
    },
    get apiKeys(): string[] {
      const multi = (process.env['ANTHROPIC_API_KEYS'] || '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
      if (multi.length > 0) return multi;
      const single = (process.env['ANTHROPIC_API_KEY'] || '').trim();
      return single ? [single] : [];
    },
  },
  // Jeton HubSpot de développement, lu uniquement par scripts/test-hubspot.ts. Le moteur ne s'en sert jamais
  // pour câbler un agent IA : les identifiants CRM viennent de la base (revue d'isolation I-2).
  hubspot: {
    get accessToken(): string { return process.env['HUBSPOT_TOKEN'] || ''; },
  },
  credentials: {
    get encryptionKey(): string {
      return process.env['CREDENTIALS_ENCRYPTION_KEY'] || '';
    },
  },
  adminJwt: {
    get secret(): string { return process.env['ADMIN_JWT_SECRET'] || ''; },
  },
  auth: {
    get accessTtlSeconds(): number { return parseInt(process.env['ADMIN_JWT_ACCESS_TTL'] || '900', 10); },
    get refreshTtlDays(): number { return parseInt(process.env['ADMIN_REFRESH_TTL_DAYS'] || '30', 10); },
    get inviteTtlDays(): number { return parseInt(process.env['ADMIN_INVITE_TTL_DAYS'] || '7', 10); },
    get resetTtlHours(): number { return parseInt(process.env['ADMIN_RESET_TTL_HOURS'] || '2', 10); },
    get bcryptRounds(): number { return parseInt(process.env['ADMIN_BCRYPT_ROUNDS'] || '12', 10); },
    get webOrigin(): string { return process.env['ADMIN_WEB_ORIGIN'] || 'http://localhost:3000'; },
  },
  webhook: {
    // Message entrant plus ancien que ce seuil : ignoré (audit 5.13).
    get maxMessageAgeHours(): number { return positiveInt('MESSAGE_MAX_AGE_HOURS', 24); },
  },
  // Délai maximal d'attente des traitements en cours à l'arrêt (audit 5.5).
  get shutdownTimeoutMs(): number { return positiveInt('SHUTDOWN_TIMEOUT_MS', 15000); },
  port: parseInt(process.env['PORT'] || '3800', 10),
  baseUrl: process.env['BASE_URL'] || 'https://demo.cyran.ai',
  databaseUrl: process.env['DATABASE_URL'] || '',
} as const;
