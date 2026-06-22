import 'dotenv/config';

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`[Config] Missing env var: ${key}`);
  return val;
}

export const config = {
  cm: {
    get productToken(): string { return process.env['CM_PRODUCT_TOKEN'] || ''; },
    get serviceUrl(): string { return process.env['CM_SERVICE_URL'] || 'https://gw.cmtelecom.com/v1.0/message'; },
    get fromNumber(): string { return process.env['CM_FROM_NUMBER'] || ''; },
  },
  meta: {
    get phoneNumberId(): string { return process.env['META_PHONE_NUMBER_ID'] || ''; },
    get accessToken(): string { return process.env['META_ACCESS_TOKEN'] || ''; },
    get appSecret(): string { return process.env['META_APP_SECRET'] || ''; },
    get verifyToken(): string { return process.env['META_VERIFY_TOKEN'] || ''; },
  },
  anthropic: {
    apiKey: required('ANTHROPIC_API_KEY'),
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
  hubspot: {
    get accessToken(): string { return process.env['HUBSPOT_TOKEN'] || ''; },
    get clientSecret(): string { return process.env['HUBSPOT_SECRET'] || ''; },
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
  port: parseInt(process.env['PORT'] || '3800', 10),
  adminPhones: (process.env['ADMIN_PHONES'] || '').split(',').map(p => p.trim()).filter(Boolean),
  baseUrl: process.env['BASE_URL'] || 'https://demo.cyran.ai',
  dashboardApiKey: process.env['DASHBOARD_API_KEY'] || '',
  databaseUrl: process.env['DATABASE_URL'] || '',
} as const;
