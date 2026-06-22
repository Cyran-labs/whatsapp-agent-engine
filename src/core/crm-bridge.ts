/**
 * CRM Bridge — orchestrateur entre l'event bus interne et les connecteurs CRM.
 *
 * Au boot, scanne tous les bots configurés. Pour chaque bot ayant un `crm.connector`,
 * instancie le connecteur correspondant via le registry et le câble sur l'event bus.
 *
 * Le routage des événements se fait par matching (client_id, bot_id) : un événement
 * `lead.qualified` du bot A ne déclenche que le connecteur du bot A.
 *
 * Stratégie d'erreur P1 : fire-and-forget. Les erreurs CRM sont loguées mais ne
 * bloquent pas la conversation WhatsApp. Dead letter queue en P2.
 */

import { config } from './config.js';
import { events, type LeadEvent } from './events.js';
import { listBots, type BotConfig } from './bot-config.js';
import { createConnector } from '../connectors/registry.js';
import type { CRMConnector } from '../connectors/types.js';
import { resolveCrmCredentials } from './credentials/resolver.js';
import { getMapping } from './config-store.js';
import type { FieldMapping } from '../connectors/field-mapper.js';
import { setLastCrmError } from './db.js';

const FIELDMAPPER_CONNECTORS = new Set(['hubspot', 'pipedrive', 'salesforce', 'zoho']);

interface BridgeEntry {
  client_id: string;
  bot_id: string;
  connector: CRMConnector;
}

const entries: BridgeEntry[] = [];
let initialized = false;

export async function initCrmBridge(): Promise<void> {
  if (initialized) {
    console.warn('[CrmBridge] Already initialized, skipping');
    return;
  }

  const bots = listBots();
  for (const bot of bots) {
    if (!bot.crm?.connector) continue;

    try {
      const connector = await instantiateConnector(bot);
      entries.push({
        client_id: bot.client_id,
        bot_id: bot.bot_id,
        connector,
      });
      console.log(`[CrmBridge] Bound ${bot.client_id}/${bot.bot_id} -> ${bot.crm.connector}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[CrmBridge] Failed to bind ${bot.client_id}/${bot.bot_id} -> ${bot.crm.connector}: ${message}`);
    }
  }

  if (entries.length === 0) {
    console.log('[CrmBridge] No CRM connector configured for any bot');
    initialized = true;
    return;
  }

  events.subscribeLead((event: LeadEvent) => {
    handleLeadEvent(event).catch(err => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[CrmBridge] Unexpected error: ${message}`);
    });
  });

  initialized = true;
  console.log(`[CrmBridge] Listening for lead events (${entries.length} connector(s) wired)`);
}

async function handleLeadEvent(event: LeadEvent): Promise<void> {
  const matching = entries.filter(
    e => e.client_id === event.lead.client_id && e.bot_id === event.lead.bot_id
  );

  if (matching.length === 0) return;

  await Promise.all(matching.map(async entry => {
    try {
      if (event.type === 'qualified' || event.type === 'updated') {
        await entry.connector.pushLead(event.lead);
        console.log(`[CrmBridge] ${event.type} -> ${entry.connector.connectorName} OK (${entry.client_id}/${entry.bot_id}, fields: ${event.changed_fields.join(',')})`);
        setLastCrmError(entry.client_id, entry.bot_id, null).catch((e) =>
          console.error(`[CrmBridge] persist clear failed: ${e instanceof Error ? e.message : String(e)}`)
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[CrmBridge] ${event.type} -> ${entry.connector.connectorName} FAILED (${entry.client_id}/${entry.bot_id}): ${message}`);
      setLastCrmError(entry.client_id, entry.bot_id, message).catch((e) =>
        console.error(`[CrmBridge] persist error failed: ${e instanceof Error ? e.message : String(e)}`)
      );
      // P2 : pousser en dead letter queue ici
    }
  }));
}

/**
 * Instancie un connecteur avec les credentials résolus par tenant
 * (resolveCrmCredentials), fallback config global (.env) pour hubspot.
 * mad-crm reste un stub : il ne doit pas bloquer le bridge.
 */
export async function instantiateConnector(bot: BotConfig): Promise<CRMConnector> {
  const connectorType = bot.crm!.connector;

  if (connectorType === 'mad-crm') {
    throw new Error('mad-crm connector pending API access (skeleton only, see src/connectors/mad-crm.ts)');
  }

  const resolved = await resolveCrmCredentials(bot.client_id, bot.bot_id, connectorType);
  let credentials: Record<string, string> = resolved;

  // Fallback config pour hubspot (rétrocompat avec le câblage P1).
  if (Object.keys(resolved).length === 0 && connectorType === 'hubspot') {
    if (!config.hubspot.accessToken) {
      throw new Error('HUBSPOT_TOKEN env var is missing and no DB credential found');
    }
    credentials = { access_token: config.hubspot.accessToken };
  }

  // hubspot a besoin du client_id pour la déduplication par tenant.
  if (connectorType === 'hubspot') {
    credentials = { ...credentials, client_id: bot.client_id };
  }

  // Fail-closed : un webhook-generic sans url câblerait un connecteur cassé
  // (POST vers '' à chaque event). On échoue au bind plutôt que silencieusement.
  if (connectorType === 'webhook-generic' && !credentials['url']) {
    throw new Error('webhook-generic connector requires a "url" credential (per-bot/client)');
  }

  let mapping: FieldMapping | undefined;
  if (FIELDMAPPER_CONNECTORS.has(connectorType)) {
    const resolved = await getMapping(bot.client_id, bot.bot_id, connectorType);
    if (!resolved) {
      throw new Error(`[CrmBridge] no mapping configured for ${bot.client_id}/${bot.bot_id} -> ${connectorType}`);
    }
    mapping = resolved;
  }

  switch (connectorType) {
    case 'hubspot':
    case 'pipedrive':
    case 'salesforce':
    case 'zoho':
      return createConnector({ type: connectorType, credentials, mapping });
    case 'attio':
    case 'webhook-generic':
      return createConnector({ type: connectorType, credentials });
    default:
      throw new Error(`Unknown CRM connector type: ${connectorType}`);
  }
}
