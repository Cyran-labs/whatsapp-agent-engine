import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteDriver } from '../../database/sqlite.js';
import type { Database } from '../../database/types.js';
import { SettingsService } from '../settings-service.js';
import { AppError } from '../../../api/errors.js';

const DEFAULTS = { visibility: 'all', pool_self_claim: true, reassign: 'managers', transfer: 'managers', takeover: 'owner' };

describe('SettingsService', () => {
  let db: Database;
  let svc: SettingsService;
  beforeEach(async () => {
    db = createSqliteDriver(':memory:');
    await db.upsertClient({ client_id: 'acme', name: 'Acme', status: 'active' });
    await db.upsertClient({ client_id: 'other', name: 'Other', status: 'active' });
    svc = new SettingsService({ db });
  });
  afterEach(async () => { vi.restoreAllMocks(); await db.close(); });

  it('get d\'une organisation neuve vaut les défauts', async () => {
    expect(await svc.get('acme')).toEqual(DEFAULTS);
  });

  it('update fusionne sur l\'existant, persiste et journalise settings.update', async () => {
    await svc.update('acme', 7, { pool_self_claim: false });
    const out = await svc.update('acme', 7, { transfer: 'everyone' });
    expect(out).toEqual({ ...DEFAULTS, pool_self_claim: false, transfer: 'everyone' });
    expect(await svc.get('acme')).toEqual(out);
    expect(await svc.get('other')).toEqual(DEFAULTS);
    const audit = await db.listAuditLog('acme');
    expect(audit.filter((a) => a.action === 'settings.update')).toHaveLength(2);
  });

  it('refuse une visibilité autre que « all » (400, chemin visibility) sans rien écrire', async () => {
    for (const visibility of ['entities', 'own_and_pool'] as const) {
      const err = await svc.update('acme', 7, { visibility }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AppError);
      const app = err as AppError;
      expect(app.status).toBe(400);
      expect(app.details).toEqual([{ path: 'visibility', message: "Ce mode de visibilité n'est pas encore disponible." }]);
    }
    expect(await db.getClientSettings('acme')).toEqual({});
    expect((await db.listAuditLog('acme')).some((a) => a.action === 'settings.update')).toBe(false);
    expect(await svc.update('acme', 7, { visibility: 'all' })).toEqual(DEFAULTS);
  });

  it('un JSON stocké invalide ne fait pas échouer get : défauts pour les champs invalides, une trace [Settings]', async () => {
    await db.setClientSettings('acme', { visibility: 'galaxie', pool_self_claim: 'oui', transfer: 'everyone', inconnu: 1 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await svc.get('acme')).toEqual({ ...DEFAULTS, transfer: 'everyone' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('[Settings]');
  });

  it('ne journalise rien quand le JSON stocké est valide ou vide', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await svc.get('acme');
    await db.setClientSettings('acme', { transfer: 'everyone' });
    await svc.get('acme');
    expect(warn).not.toHaveBeenCalled();
  });

  it('update sur un JSON stocké invalide repart des défauts pour les champs invalides', async () => {
    await db.setClientSettings('acme', { reassign: 42 });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await svc.update('acme', 7, { takeover: 'entity_members' })).toEqual({ ...DEFAULTS, takeover: 'entity_members' });
  });
});
