import 'dotenv/config';

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`[Config] Missing env var: ${key}`);
  return val;
}

export const config = {
  cm: {
    productToken: process.env['CM_PRODUCT_TOKEN'] || '',
    serviceUrl: process.env['CM_SERVICE_URL'] || 'https://gw.cmtelecom.com/v1.0/message',
    fromNumber: process.env['CM_FROM_NUMBER'] || '',
  },
  meta: {
    phoneNumberId: process.env['META_PHONE_NUMBER_ID'] || '',
    accessToken: process.env['META_ACCESS_TOKEN'] || '',
    appSecret: process.env['META_APP_SECRET'] || '',
    verifyToken: process.env['META_VERIFY_TOKEN'] || '',
  },
  anthropic: {
    apiKey: required('ANTHROPIC_API_KEY'),
  },
  hubspot: {
    accessToken: process.env['HUBSPOT_TOKEN'] || '',
    clientSecret: process.env['HUBSPOT_SECRET'] || '',
  },
  port: parseInt(process.env['PORT'] || '3800', 10),
  adminPhones: (process.env['ADMIN_PHONES'] || '').split(',').map(p => p.trim()).filter(Boolean),
  baseUrl: process.env['BASE_URL'] || 'https://demo.cyran.ai',
  dashboardApiKey: process.env['DASHBOARD_API_KEY'] || '',
  databaseUrl: process.env['DATABASE_URL'] || '',
} as const;
