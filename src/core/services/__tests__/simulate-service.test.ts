import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteDriver } from '../../database/sqlite.js';
import { __setDatabaseForTests } from '../../database/index.js';
import { resetConfigStore, upsertBot } from '../../config-store.js';
import type { Database, BotRecord } from '../../database/types.js';
import { SimulateService } from '../simulate-service.js';

const botRec: BotRecord = {
  client_id: 'acme',
  bot_id: 'sales',
  name: 'Ventes',
  transport: 'meta-cloud',
  status: 'draft',
  default_language: 'fr',
  languages: ['fr'],
  system_prompt: { fr: 'Tu es un assistant ventes.' },
  lead_fields: '',
  welcome: { enabled: false, message: {} },
  error_messages: {},
  catalog: null,
  llm: null,
  crm: null,
};

describe('SimulateService', () => {
  let db: Database;
  beforeEach(async () => {
    db = createSqliteDriver(':memory:');
    __setDatabaseForTests(db);
    resetConfigStore();
    await upsertBot(botRec, []);
  });

  it('crée une session et renvoie la réponse + le modèle', async () => {
    const chatFn = vi.fn().mockResolvedValue('Bonjour, comment puis-je aider ?');
    const svc = new SimulateService({ chatFn });
    const r = await svc.simulate('acme', 'sales', { message: 'salut' });
    expect(r.reply).toBe('Bonjour, comment puis-je aider ?');
    expect(r.model).toBe('claude-haiku-4-5-20251001');
    expect(r.session_id).toBeTruthy();
    // chat appelé avec Haiku et le system prompt du bot
    const call = chatFn.mock.calls[0];
    expect(call[2]).toMatchObject({ clientId: 'acme', botId: 'sales', model: 'claude-haiku-4-5-20251001' });
  });

  it("conserve l'historique entre deux tours de la même session", async () => {
    const chatFn = vi.fn().mockResolvedValueOnce('R1').mockResolvedValueOnce('R2');
    const svc = new SimulateService({ chatFn });
    const a = await svc.simulate('acme', 'sales', { message: 'm1' });
    await svc.simulate('acme', 'sales', { session_id: a.session_id, message: 'm2' });
    // au 2e appel, messages contient m1/R1/m2
    const secondMessages = chatFn.mock.calls[1][1] as { role: string; content: string }[];
    expect(secondMessages.map((m) => m.content)).toEqual(['m1', 'R1', 'm2']);
  });

  it('ne persiste aucun lead ni conversation', async () => {
    const svc = new SimulateService({ chatFn: vi.fn().mockResolvedValue('x') });
    await svc.simulate('acme', 'sales', { message: 'salut' });
    const leads = await db.listLeadsByBot('acme', 'sales', { limit: 10, offset: 0 });
    expect(leads.total).toBe(0);
  });

  it('bot inconnu → notFound', async () => {
    const svc = new SimulateService({ chatFn: vi.fn() });
    await expect(svc.simulate('acme', 'ghost', { message: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it("un session_id d'un autre bot est ignoré (nouvelle session)", async () => {
    await upsertBot({ ...botRec, bot_id: 'support', name: 'Support' }, []);
    const svc = new SimulateService({ chatFn: vi.fn().mockResolvedValue('y') });
    const a = await svc.simulate('acme', 'sales', { message: 'm1' });
    const b = await svc.simulate('acme', 'support', { session_id: a.session_id, message: 'm2' });
    expect(b.session_id).not.toBe(a.session_id);
  });

  it("un session_id d'un autre clientId est ignoré (isolation multi-tenant)", async () => {
    await db.upsertClient({ client_id: 'beta', name: 'Beta', status: 'active' });
    await upsertBot({ ...botRec, client_id: 'beta' }, []);
    const svc = new SimulateService({ chatFn: vi.fn().mockResolvedValue('y') });
    const a = await svc.simulate('acme', 'sales', { message: 'm1' });
    const b = await svc.simulate('beta', 'sales', { session_id: a.session_id, message: 'm2' });
    expect(b.session_id).not.toBe(a.session_id);
  });

  it('par défaut force le mode platform + Haiku (gratuit)', async () => {
    const chatFn = vi.fn().mockResolvedValue('ok');
    const svc = new SimulateService({ chatFn });
    const r = await svc.simulate('acme', 'sales', { message: 'salut' });
    expect(r.model).toBe('claude-haiku-4-5-20251001');
    const opts = chatFn.mock.calls[0][2];
    expect(opts).toMatchObject({ clientId: 'acme', botId: 'sales', model: 'claude-haiku-4-5-20251001', mode: 'platform' });
  });

  it('use_bot_config suit la config du bot (modèle configuré, pas de mode force)', async () => {
    await upsertBot({ ...botRec, llm: { mode: 'byo', model: 'claude-sonnet-4-5-20250929' } }, []);
    const chatFn = vi.fn().mockResolvedValue('ok');
    const svc = new SimulateService({ chatFn });
    const r = await svc.simulate('acme', 'sales', { message: 'salut', use_bot_config: true });
    expect(r.model).toBe('claude-sonnet-4-5-20250929');
    const opts = chatFn.mock.calls[0][2];
    expect(opts.model).toBe('claude-sonnet-4-5-20250929');
    expect(opts.mode).toBeUndefined(); // pas de force -> résolution naturelle
  });
});
