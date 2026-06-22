/**
 * Métadonnées des providers d'identifiants (transport / CRM / LLM).
 * Source unique pour : le catalogue UI, le masquage des secrets en lecture,
 * et la validation des champs acceptés en écriture.
 */

export interface CredentialField {
  name: string;
  label: string;
  secret: boolean;
}

export interface ProviderDef {
  label: string;
  fields: CredentialField[];
}

export type CredentialService = 'transport' | 'crm' | 'llm';

export const PROVIDERS: Record<CredentialService, Record<string, ProviderDef>> = {
  transport: {
    'meta-cloud': {
      label: 'WhatsApp — Meta Cloud API',
      fields: [
        { name: 'phone_number_id', label: 'Phone Number ID', secret: false },
        { name: 'access_token', label: 'Access Token', secret: true },
        { name: 'app_secret', label: 'App Secret', secret: true },
      ],
    },
    'cm-com': {
      label: 'WhatsApp — CM.com',
      fields: [
        { name: 'product_token', label: 'Product Token', secret: true },
        { name: 'from_number', label: 'Numéro émetteur', secret: false },
        { name: 'service_url', label: 'Service URL', secret: false },
      ],
    },
  },
  crm: {
    hubspot: { label: 'HubSpot', fields: [{ name: 'access_token', label: 'Private App Token', secret: true }] },
    attio: { label: 'Attio', fields: [{ name: 'api_key', label: 'API Key', secret: true }] },
    pipedrive: { label: 'Pipedrive', fields: [{ name: 'api_token', label: 'API Token', secret: true }, { name: 'company_domain', label: 'Domaine', secret: false }] },
    salesforce: { label: 'Salesforce', fields: [{ name: 'instance_url', label: 'Instance URL', secret: false }, { name: 'access_token', label: 'Access Token', secret: true }] },
    zoho: { label: 'Zoho', fields: [{ name: 'access_token', label: 'Access Token', secret: true }, { name: 'api_domain', label: 'API Domain', secret: false }] },
    'webhook-generic': { label: 'Webhook générique', fields: [{ name: 'url', label: 'URL', secret: false }, { name: 'secret', label: 'Secret HMAC', secret: true }] },
  },
  llm: {
    anthropic: { label: 'Anthropic', fields: [{ name: 'api_key', label: 'API Key', secret: true }] },
  },
};

export function getProviderDef(service: string, provider: string): ProviderDef | undefined {
  const svc = PROVIDERS[service as CredentialService];
  return svc ? svc[provider] : undefined;
}

export function maskSecret(value: string): string {
  return value.length >= 4 ? `••••${value.slice(-4)}` : '••••';
}

export function maskCredentials(def: ProviderDef, values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of def.fields) {
    const v = values[field.name];
    if (v === undefined) continue;
    out[field.name] = field.secret ? maskSecret(v) : v;
  }
  return out;
}

export function connectorsCatalogue(): Array<{ service: CredentialService; provider: string; label: string; fields: CredentialField[] }> {
  const out: Array<{ service: CredentialService; provider: string; label: string; fields: CredentialField[] }> = [];
  for (const service of Object.keys(PROVIDERS) as CredentialService[]) {
    for (const [provider, def] of Object.entries(PROVIDERS[service])) {
      out.push({ service, provider, label: def.label, fields: def.fields });
    }
  }
  return out;
}
