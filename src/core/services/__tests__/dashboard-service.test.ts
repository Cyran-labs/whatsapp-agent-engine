import { beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../../database/sqlite.js';
import type { Database } from '../../database/types.js';
import { CredentialsService } from '../credentials-service.js';
import { DashboardService } from '../dashboard-service.js';

describe('DashboardService — leads', () => {
  let db: Database; let svc: DashboardService;
  beforeEach(async () => {
    process.env['CREDENTIALS_ENCRYPTION_KEY'] = '0'.repeat(64);
    db = createSqliteDriver(':memory:');
    svc = new DashboardService({ db, credentials: new CredentialsService({ db }) });
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await db.upsertBotRecord({ client_id: 'acme', bot_id: 'sales', name: 'Ventes', transport: 'meta-cloud', status: 'draft', default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'a' }, lead_fields: '', welcome: { enabled: false, message: {} }, error_messages: {}, catalog: null, llm: null, crm: null });
    await db.upsertBotRecord({ client_id: 'acme', bot_id: 'support', name: 'Support', transport: 'meta-cloud', status: 'draft', default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'a' }, lead_fields: '', welcome: { enabled: false, message: {} }, error_messages: {}, catalog: null, llm: null, crm: null });
    await db.saveLead('+33600000001', 'acme', 'sales', { phone: '+33600000001', name: 'Alice', budget: '10k' });
    await db.saveLead('+33600000002', 'acme', 'sales', { phone: '+33600000002', name: 'Bob' });
    await db.saveLead('+33600000003', 'acme', 'support', { phone: '+33600000003', name: 'Carol' });
    await db.addMessage('+33600000001', 'acme', 'sales', 'user', 'bonjour');
    await db.addMessage('+33600000001', 'acme', 'sales', 'assistant', 'salut Alice');
  });

  it('liste paginée scoping client+bot', async () => {
    const res = await svc.listLeads('acme', 'sales', { page: 1, page_size: 10 });
    expect(res.total).toBe(2);
    expect(res.leads.map((l) => l.phone).sort()).toEqual(['+33600000001', '+33600000002']);
  });

  it('filtre recherche par nom/téléphone', async () => {
    const res = await svc.listLeads('acme', 'sales', { page: 1, page_size: 10, search: 'Alice' });
    expect(res.total).toBe(1);
    expect(res.leads[0]?.name).toBe('Alice');
  });

  it('pagination : page_size=1 borne les résultats mais total reste global', async () => {
    const res = await svc.listLeads('acme', 'sales', { page: 1, page_size: 1 });
    expect(res.leads.length).toBe(1);
    expect(res.total).toBe(2);
  });

  it('détail lead = données qualifiées + transcript chrono', async () => {
    const d = await svc.getLead('acme', 'sales', '+33600000001');
    expect(d.qualified_data).toMatchObject({ budget: '10k' });
    expect(d.transcript.map((m) => m.content)).toEqual(['bonjour', 'salut Alice']);
  });

  it('détail lead inconnu → throw notFound', async () => {
    await expect(svc.getLead('acme', 'sales', '+33699999999')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('listLeads retourne qualified_data comme objet parsé (pas string JSON)', async () => {
    const res = await svc.listLeads('acme', 'sales', { page: 1, page_size: 10 });
    const alice = res.leads.find((l) => l.phone === '+33600000001');
    expect(alice).toBeDefined();
    expect(typeof alice!.qualified_data).toBe('object');
    expect(alice!.qualified_data).toMatchObject({ budget: '10k' });
  });
});
