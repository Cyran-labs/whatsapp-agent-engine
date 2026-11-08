import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase } from '../../test-support/test-database.js';
import { __setDatabaseForTests } from '../database/index.js';
import { resetConfigStore, upsertBot } from '../config-store.js';
import { findRoute, checkServable } from '../router.js';
import { BotService } from '../services/bot-service.js';
import type { BotRecord, Database } from '../database/types.js';

function rec(clientId: string, botId: string, status = 'active'): BotRecord {
  return {
    client_id: clientId, bot_id: botId, name: botId, transport: 'meta-cloud', status,
    status_reason: null,
    default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'Prompt' }, lead_fields: '',
    welcome: { enabled: false, message: {} }, error_messages: {}, catalog: null, llm: null, crm: null, personality: null, entity_id: null,
  };
}

describe('routage par numéro destinataire et statut à l\'exécution', () => {
  let db: Database;

  beforeEach(async () => {
    db = await createTestDatabase();
    __setDatabaseForTests(db);
    resetConfigStore();
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await db.upsertClient({ client_id: 'beta', name: 'Beta', status: 'active' });
    await upsertBot(rec('acme', 'ventes'), ['+33100000001']);
    await upsertBot(rec('beta', 'accueil'), ['+33100000002']);
  });

  afterEach(async () => {
    resetConfigStore();
    await db.close();
  });

  // audit 1.1
  it("route par le numéro destinataire même si le contact a une session avec une autre organisation", async () => {
    await db.createSessionIfAbsent('+33100000001', '33600000001', 'acme', 'ventes');
    expect(findRoute('+33100000002')?.client_id).toBe('beta');
    expect(findRoute('+33100000002')?.bot_id).toBe('accueil');
  });

  it('ne crée ni ne modifie aucune session', async () => {
    expect(findRoute('+33100000001')?.bot_id).toBe('ventes');
    expect(await db.getSession('+33100000001', '33600000001')).toBeUndefined();
  });

  it('numéro en chiffres seuls : résolu vers le numéro stocké en E.164', () => {
    expect(findRoute('33100000001')?.bot_id).toBe('ventes');
  });

  it('numéro inconnu ou non normalisable : null', () => {
    expect(findRoute('+33199999999')).toBeNull();
    expect(findRoute('pas-un-numero')).toBeNull();
    expect(findRoute('')).toBeNull();
  });

  it("la configuration routée porte le statut de l'agent IA", async () => {
    await upsertBot(rec('acme', 'ventes', 'paused'), ['+33100000001']);
    expect(findRoute('+33100000001')?.status).toBe('paused');
  });

  // audit 3.1
  it.each([
    ['draft', 'active', 'bot_inactive'],
    ['paused', 'active', 'bot_inactive'],
    ['active', 'suspended', 'org_inactive'],
    ['active', 'active', 'ok'],
  ])('agent IA %s, organisation %s : %s', async (botStatus, orgStatus, expected) => {
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: orgStatus });
    // upsertBotRecord ne change plus le statut d'un agent IA existant (revue 2b-1 I-3) : écriture ciblée, puis cache.
    await db.setBotStatusUnchecked('acme', 'ventes', botStatus);
    await upsertBot(rec('acme', 'ventes', botStatus), ['+33100000001']);
    const bot = findRoute('+33100000001');
    expect(bot).not.toBeNull();
    expect(await checkServable(bot!)).toBe(expected);
  });

  // audit 3.1
  it("organisation inconnue : non servie", async () => {
    await upsertBot(rec('fantome', 'x'), ['+33100000009']);
    expect(await checkServable(findRoute('+33100000009')!)).toBe('org_inactive');
  });

  // audit 3.1
  it("le statut de l'organisation est lu en base à chaque appel", async () => {
    const bot = findRoute('+33100000001')!;
    expect(await checkServable(bot)).toBe('ok');
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'suspended' });
    expect(await checkServable(bot)).toBe('org_inactive');
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    expect(await checkServable(bot)).toBe('ok');
  });

  // audit 3.1
  it('le passage en pause est vu sans redémarrage', async () => {
    await db.setTransportValidation('acme', 'ventes', new Date().toISOString(), null);
    const service = new BotService({ db });
    const before = findRoute('+33100000001')!;
    expect(await checkServable(before)).toBe('ok');

    await service.setStatus('acme', 'ventes', null, 'paused');

    const after = findRoute('+33100000001')!;
    expect(await checkServable(after)).toBe('bot_inactive');

    await service.setStatus('acme', 'ventes', null, 'active');
    expect(await checkServable(findRoute('+33100000001')!)).toBe('ok');
  });

  // audit 3.1, revue d'isolation I-1 : le statut de l'agent IA est lu en base, pas dans le cache.
  it("cache resté actif alors que la base dit en pause : non servi", async () => {
    const bot = findRoute('+33100000001')!;
    expect(bot.status).toBe('active');
    expect(await checkServable(bot)).toBe('ok');
    // Écriture directe en base : le cache mémoire n'est pas rafraîchi (écart observé sous concurrence).
    await db.setBotStatusUnchecked('acme', 'ventes', 'paused');
    expect(findRoute('+33100000001')!.status).toBe('active');
    expect(await checkServable(findRoute('+33100000001')!)).toBe('bot_inactive');
  });

  // audit 3.1, revue d'isolation I-1
  it("cache en pause alors que la base dit actif : servi (la base fait foi)", async () => {
    await upsertBot(rec('acme', 'ventes', 'paused'), ['+33100000001']);
    await db.setBotStatusUnchecked('acme', 'ventes', 'active');
    expect(findRoute('+33100000001')!.status).toBe('paused');
    expect(await checkServable(findRoute('+33100000001')!)).toBe('ok');
  });

  // audit 3.1, revue d'isolation I-1
  it("agent IA absent en base mais présent en cache : non servi", async () => {
    const bot = findRoute('+33100000001')!;
    await db.deleteBotRecord('acme', 'ventes');
    expect(await checkServable(bot)).toBe('bot_inactive');
  });
});
