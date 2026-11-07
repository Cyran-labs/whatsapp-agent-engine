import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteDriver } from '../../database/sqlite.js';
import type { Database } from '../../database/types.js';
import { ensureDefaultEntity } from '../../database/migrate-accounts.js';
import { EntityService } from '../entity-service.js';
import { seedOrgMember } from '../../auth/__tests__/fixtures.js';

const botRecord = (entityId: number) => ({
  client_id: 'acme', bot_id: 'sales', name: 'Ventes', transport: 'meta-cloud', status: 'draft',
  default_language: 'fr', languages: ['fr'], system_prompt: { fr: 'Agent.' }, lead_fields: '',
  welcome: { enabled: false, message: {} }, error_messages: {}, catalog: null, llm: null, crm: null,
  personality: null, entity_id: entityId,
});

describe('EntityService', () => {
  let db: Database;
  let svc: EntityService;
  beforeEach(async () => {
    db = createSqliteDriver(':memory:');
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await db.upsertClient({ client_id: 'other', name: 'Other', status: 'active' });
    svc = new EntityService({ db });
  });
  afterEach(async () => { await db.close(); });

  it('crée une entité (audit entity.create) et la liste avec compteurs', async () => {
    const def = await ensureDefaultEntity(db, 'acme');
    const created = await svc.create('acme', 7, { name: 'Paris' });
    expect(created.name).toBe('Paris');
    expect(created.status).toBe('active');
    await db.upsertBotRecord(botRecord(created.id));
    await seedOrgMember(db, { email: 'm@acme.test', password: 'motdepasse123', clientId: 'acme', grants: [{ entity_id: created.id, role: 'advisor' }] });
    const list = await svc.list('acme');
    expect(list.map((e) => e.name)).toEqual([def.name, 'Paris']);
    const paris = list.find((e) => e.id === created.id)!;
    expect(paris.bots).toBe(1);
    expect(paris.members).toBe(1);
    expect(list.find((e) => e.id === def.id)).toMatchObject({ bots: 0, members: 0 });
    const audit = await db.listAuditLog('acme');
    expect(audit.some((a) => a.action === 'entity.create')).toBe(true);
  });

  it('refuse un nom déjà porté par une entité active (409), accepte le nom d\'une entité archivée', async () => {
    const a = await svc.create('acme', 7, { name: 'Paris' });
    await expect(svc.create('acme', 7, { name: 'Paris' })).rejects.toMatchObject({
      code: 'CONFLICT', message: 'Une entité porte déjà ce nom.',
    });
    await svc.update('acme', a.id, 7, { status: 'archived' });
    const again = await svc.create('acme', 7, { name: 'Paris' });
    expect(again.id).not.toBe(a.id);
  });

  it('renommer vers un nom actif existant : 409 ; renommer en son propre nom : accepté', async () => {
    await svc.create('acme', 7, { name: 'Paris' });
    const lyon = await svc.create('acme', 7, { name: 'Lyon' });
    await expect(svc.update('acme', lyon.id, 7, { name: 'Paris' })).rejects.toMatchObject({ code: 'CONFLICT' });
    const same = await svc.update('acme', lyon.id, 7, { name: 'Lyon' });
    expect(same.name).toBe('Lyon');
    const renamed = await svc.update('acme', lyon.id, 7, { name: 'Lille' });
    expect(renamed.name).toBe('Lille');
    expect((await db.listAuditLog('acme')).some((a) => a.action === 'entity.update')).toBe(true);
  });

  it('archivage refusé avec un agent IA, puis avec un membre actif, accepté une fois vides', async () => {
    const e = await svc.create('acme', 7, { name: 'Paris' });
    await db.upsertBotRecord(botRecord(e.id));
    const guard = { code: 'CONFLICT', message: "Déplacez d'abord les agents IA et les membres de cette entité." };
    await expect(svc.update('acme', e.id, 7, { status: 'archived' })).rejects.toMatchObject(guard);

    const other = await svc.create('acme', 7, { name: 'Lyon' });
    await db.upsertBotRecord(botRecord(other.id));
    await seedOrgMember(db, { email: 'm@acme.test', password: 'motdepasse123', clientId: 'acme', grants: [{ entity_id: e.id, role: 'manager' }] });
    await expect(svc.update('acme', e.id, 7, { status: 'archived' })).rejects.toMatchObject(guard);

    const user = (await db.getUserByEmail('m@acme.test'))!;
    await db.replaceMemberships(user.id, 'acme', [{ entity_id: other.id, role: 'manager' }]);
    const archived = await svc.update('acme', e.id, 7, { status: 'archived' });
    expect(archived.status).toBe('archived');
  });

  it('entité d\'une autre organisation : 404 avant tout contrôle d\'usage', async () => {
    const e = await svc.create('other', 7, { name: 'Marseille' });
    await expect(svc.update('acme', e.id, 7, { name: 'X' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(svc.update('acme', e.id, 7, { status: 'archived' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(svc.update('acme', 9999, 7, { name: 'X' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('list exclut les archivées par défaut, les inclut avec includeArchived', async () => {
    const e = await svc.create('acme', 7, { name: 'Paris' });
    await svc.update('acme', e.id, 7, { status: 'archived' });
    expect(await svc.list('acme')).toHaveLength(0);
    expect(await svc.list('acme', { includeArchived: true })).toHaveLength(1);
  });
});
