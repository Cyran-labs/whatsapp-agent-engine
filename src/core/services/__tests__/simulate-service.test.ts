import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteDriver } from '../../database/sqlite.js';
import { __setDatabaseForTests } from '../../database/index.js';
import { resetConfigStore, upsertBot } from '../../config-store.js';
import type { Database, BotRecord } from '../../database/types.js';
import { SimulateService } from '../simulate-service.js';

/** Réponse de chatWithModel : texte et modèle qui a réellement répondu. */
const answer = (text: string, model = 'claude-sonnet-5-5') => ({ text, model });

const botRec: BotRecord = {
  client_id: 'acme',
  bot_id: 'sales',
  name: 'Ventes',
  status: 'draft',
  status_reason: null,
  default_language: 'fr',
  languages: ['fr'],
  system_prompt: { fr: 'Tu es un assistant ventes.' },
  lead_fields: '',
  welcome: { enabled: false, message: {} },
  error_messages: {},
  catalog: null,
  llm: null,
  crm: null, personality: null, entity_id: null,
};

describe('SimulateService', () => {
  let db: Database;
  beforeEach(async () => {
    db = createSqliteDriver(':memory:');
    __setDatabaseForTests(db);
    resetConfigStore();
    await upsertBot(botRec);
  });

  it('crée une session et renvoie la réponse + le modèle qui a réellement répondu', async () => {
    const chatFn = vi.fn().mockResolvedValue(answer('Bonjour, comment puis-je aider ?', 'claude-sonnet-5'));
    const svc = new SimulateService({ chatFn });
    const r = await svc.simulate('acme', 'sales', { message: 'salut' });
    expect(r.reply).toBe('Bonjour, comment puis-je aider ?');
    // Bascule dans la cascade : le test affiche le modèle qui a servi, pas un modèle supposé.
    expect(r.model).toBe('claude-sonnet-5');
    expect(r.session_id).toBeTruthy();
    const call = chatFn.mock.calls[0];
    expect(call[0]).toEqual([{ text: 'Tu es un assistant ventes.', cache: true }]);
  });

  it("conserve l'historique entre deux tours de la même session", async () => {
    const chatFn = vi.fn().mockResolvedValueOnce(answer('R1')).mockResolvedValueOnce(answer('R2'));
    const svc = new SimulateService({ chatFn });
    const a = await svc.simulate('acme', 'sales', { message: 'm1' });
    await svc.simulate('acme', 'sales', { session_id: a.session_id, message: 'm2' });
    // au 2e appel, messages contient m1/R1/m2
    const secondMessages = chatFn.mock.calls[1][1] as { role: string; content: string }[];
    expect(secondMessages.map((m) => m.content)).toEqual(['m1', 'R1', 'm2']);
  });

  it('ne persiste aucun lead ni conversation', async () => {
    const svc = new SimulateService({ chatFn: vi.fn().mockResolvedValue(answer('x')) });
    await svc.simulate('acme', 'sales', { message: 'salut' });
    const leads = await db.listLeadsByBot('acme', 'sales', { limit: 10, offset: 0 });
    expect(leads.total).toBe(0);
  });

  it('bot inconnu → notFound', async () => {
    const svc = new SimulateService({ chatFn: vi.fn() });
    await expect(svc.simulate('acme', 'ghost', { message: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("un session_id d'un autre bot est ignoré (nouvelle session)", async () => {
    await upsertBot({ ...botRec, bot_id: 'support', name: 'Support' });
    const svc = new SimulateService({ chatFn: vi.fn().mockResolvedValue(answer('y')) });
    const a = await svc.simulate('acme', 'sales', { message: 'm1' });
    const b = await svc.simulate('acme', 'support', { session_id: a.session_id, message: 'm2' });
    expect(b.session_id).not.toBe(a.session_id);
  });

  it("un session_id d'un autre clientId est ignoré (isolation multi-tenant)", async () => {
    await db.upsertClient({ client_id: 'beta', name: 'Beta', status: 'active' });
    await upsertBot({ ...botRec, client_id: 'beta' });
    const svc = new SimulateService({ chatFn: vi.fn().mockResolvedValue(answer('y')) });
    const a = await svc.simulate('acme', 'sales', { message: 'm1' });
    const b = await svc.simulate('beta', 'sales', { session_id: a.session_id, message: 'm2' });
    expect(b.session_id).not.toBe(a.session_id);
  });

  it('par défaut : clés de la plateforme, mêmes modèles qu\'un vrai contact (cascade, aucun modèle imposé)', async () => {
    const chatFn = vi.fn().mockResolvedValue(answer('ok'));
    const svc = new SimulateService({ chatFn });
    await svc.simulate('acme', 'sales', { message: 'salut' });
    const opts = chatFn.mock.calls[0][2];
    expect(opts).toEqual({ clientId: 'acme', botId: 'sales', mode: 'platform' });
  });

  it('modèle imposé à l\'agent IA : le test l\'utilise aussi, comme un vrai contact', async () => {
    await upsertBot({ ...botRec, llm: { mode: 'byo', model: 'claude-haiku-5-5' } });
    const chatFn = vi.fn().mockResolvedValue(answer('ok', 'claude-haiku-5-5'));
    const svc = new SimulateService({ chatFn });
    await svc.simulate('acme', 'sales', { message: 'salut' });
    expect(chatFn.mock.calls[0][2]).toEqual({ clientId: 'acme', botId: 'sales', model: 'claude-haiku-5-5', mode: 'platform' });
  });

  it('use_bot_config suit la config du bot (modèle configuré, pas de mode forcé)', async () => {
    await upsertBot({ ...botRec, llm: { mode: 'byo', model: 'claude-sonnet-5' } });
    const chatFn = vi.fn().mockResolvedValue(answer('ok', 'claude-sonnet-5'));
    const svc = new SimulateService({ chatFn });
    const r = await svc.simulate('acme', 'sales', { message: 'salut', use_bot_config: true });
    expect(r.model).toBe('claude-sonnet-5');
    const opts = chatFn.mock.calls[0][2];
    expect(opts.model).toBe('claude-sonnet-5');
    expect(opts.mode).toBeUndefined(); // pas de force -> résolution naturelle
  });
});
