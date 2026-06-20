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
  hubspot: {
    accessToken: process.env['HUBSPOT_TOKEN'] || '',
    clientSecret: process.env['HUBSPOT_SECRET'] || '',
  },
  credentials: {
    get encryptionKey(): string {
      return process.env['CREDENTIALS_ENCRYPTION_KEY'] || '';
    },
  },
  port: parseInt(process.env['PORT'] || '3800', 10),
  adminPhones: (process.env['ADMIN_PHONES'] || '').split(',').map(p => p.trim()).filter(Boolean),
  baseUrl: process.env['BASE_URL'] || 'https://demo.cyran.ai',
  dashboardApiKey: process.env['DASHBOARD_API_KEY'] || '',
  databaseUrl: process.env['DATABASE_URL'] || '',
} as const;
