import 'dotenv/config';
import { PROCESSED_MESSAGES_RETENTION_HOURS } from './database/types.js';

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

const warned = new Set<string>();

/** Avertit une seule fois par couple (variable, valeur) : les réglages sont relus à chaque accès. */
function warnOnce(key: string, raw: string, message: string): void {
  const id = `${key}=${raw}`;
  if (warned.has(id)) return;
  warned.add(id);
  console.warn(`[Config] ${message}`);
}

/**
 * Entier supérieur ou égal à 1 lu dans l'environnement. Absent ou vide : valeur par défaut, sans bruit.
 * Présent mais invalide (non entier, nul, négatif) : valeur par défaut avec un avertissement.
 */
function integerAtLeastOne(key: string, fallback: number): number {
  const raw = (process.env[key] ?? '').trim();
  if (raw === '') return fallback;
  if (/^\d+$/.test(raw)) {
    const parsed = Number(raw);
    if (Number.isSafeInteger(parsed) && parsed >= 1) return parsed;
  }
  warnOnce(key, raw, `${key} invalide (entier supérieur ou égal à 1 attendu), valeur par défaut ${fallback} utilisée`);
  return fallback;
}

/**
 * Entier entre `min` et `max` inclus lu dans l'environnement. Absent ou vide : valeur par défaut, sans bruit.
 * Présent mais illisible ou hors bornes : valeur par défaut avec un avertissement, sans lever d'erreur.
 */
function integerInRange(key: string, fallback: number, min: number, max: number): number {
  const raw = (process.env[key] ?? '').trim();
  if (raw === '') return fallback;
  if (/^\d+$/.test(raw)) {
    const parsed = Number(raw);
    if (Number.isSafeInteger(parsed) && parsed >= min && parsed <= max) return parsed;
  }
  warnOnce(key, raw, `${key} invalide (entier entre ${min} et ${max} attendu), valeur par défaut ${fallback} utilisée`);
  return fallback;
}

/**
 * URL absolue `https:` (ou `http:` pour `localhost` et `127.0.0.1` seulement), sans barre finale, sans identifiants,
 * requête ni ancre. Vide : null. Sinon lève une erreur `[Config]`.
 */
function parsePublicBaseUrl(value: string): string | null {
  const raw = value.trim();
  if (raw === '') return null;
  const invalid = (why: string): Error => new Error(`[Config] PUBLIC_BASE_URL invalide (${why}) : attendu par exemple https://api.wabagent.com`);
  let url: URL;
  try { url = new URL(raw); } catch { throw invalid('URL absolue attendue'); }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw invalid('https requis, http seulement pour localhost');
  if (url.username !== '' || url.password !== '') throw invalid('identifiants interdits');
  if (url.search !== '' || url.hash !== '' || raw.includes('?') || raw.includes('#')) throw invalid('requête et ancre interdites');
  if (raw.endsWith('/')) throw invalid('sans barre finale');
  return raw;
}

export const config = {
  meta: {
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
    // Adresse publique du moteur, sans barre finale (ex. https://api.wabagent.com). Optionnelle : sans elle, la
    // vue d'un compte WhatsApp donne seulement le chemin du webhook. Invalide : le démarrage échoue (src/index.ts).
    get publicBaseUrl(): string | null { return parsePublicBaseUrl(process.env['PUBLIC_BASE_URL'] ?? ''); },
    // Message entrant plus ancien que ce seuil : ignoré (audit 5.13). Borné strictement sous la rétention des
    // clés de dédoublonnage : au-delà, un webhook rejoué après la purge de sa clé serait servi de nouveau.
    get maxMessageAgeHours(): number {
      const hours = positiveInt('MESSAGE_MAX_AGE_HOURS', 24);
      const ceiling = PROCESSED_MESSAGES_RETENTION_HOURS - 1;
      if (hours <= ceiling) return hours;
      warnOnce('MESSAGE_MAX_AGE_HOURS', String(hours), `MESSAGE_MAX_AGE_HOURS supérieur ou égal à la rétention du dédoublonnage (${PROCESSED_MESSAGES_RETENTION_HOURS} h), ramené à ${ceiling}`);
      return ceiling;
    },
  },
  welcome: {
    // Attente (ms) entre l'accusé de lecture et l'envoi du message d'accueil. Lue à l'appel : les tests la mettent à 0.
    get delayMs(): number { return integerInRange('WELCOME_DELAY_MS', 1500, 0, 10000); },
  },
  maintenance: {
    // Rétention des conversations (purge au démarrage puis toutes les 6 h).
    get conversationRetentionDays(): number { return integerAtLeastOne('CONVERSATION_RETENTION_DAYS', 90); },
  },
  // Délai maximal d'attente des traitements en cours à l'arrêt (audit 5.5).
  get shutdownTimeoutMs(): number { return positiveInt('SHUTDOWN_TIMEOUT_MS', 15000); },
  port: parseInt(process.env['PORT'] || '3800', 10),
  baseUrl: process.env['BASE_URL'] || 'https://demo.cyran.ai',
  databaseUrl: process.env['DATABASE_URL'] || '',
} as const;
