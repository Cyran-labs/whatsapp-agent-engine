import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../../core/database/types.js';
import type { WhatsAppAccountRecord } from '../../core/database/whatsapp-types.js';
import type { ProviderNumber } from '../../core/database/whatsapp-types.js';
import { WhatsAppAccountService } from '../../core/services/whatsapp-account-service.js';
import {
  ACME_FREE_NUMBER, ACME_FREE_PNID, ACME_NUMBER, ACME_PNID, ACME_SUPPORT_PNID, ACME_WABA, BETA_PNID, BETA_WABA, createWorld,
} from '../../webhooks/__tests__/fixtures.js';
import type { World } from '../../webhooks/__tests__/fixtures.js';
import { ACCOUNT_ALERT_CODES, handleMetaEvents } from '../meta-events.js';
import { createRefreshScheduler } from '../refresh-scheduler.js';
import { fakeMetaWebhooks } from '../../test-support/meta-webhooks-fake.js';
import type { RefreshScheduler } from '../refresh-scheduler.js';

type Statuses = Parameters<typeof handleMetaEvents>[1]['statuses'];
type Events = Parameters<typeof handleMetaEvents>[1]['accountEvents'];

function failed(recipientId: string, codes: number[], providerAccountId = ACME_WABA): Statuses[number] {
  return { recipientId, providerAccountId, status: 'failed', errorCodes: codes };
}

describe('handleMetaEvents', () => {
  let world: World;
  let db: Database;
  let schedule: ReturnType<typeof vi.fn<RefreshScheduler['schedule']>>;
  let scheduler: RefreshScheduler;

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    world = await createWorld();
    db = world.db;
    schedule = vi.fn<RefreshScheduler['schedule']>();
    scheduler = { schedule, stop: () => undefined };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await world.close();
  });

  const acme = (): WhatsAppAccountRecord => world.accounts.acmeMeta.account;
  const run = (statuses: Statuses, accountEvents: Events = [], account: WhatsAppAccountRecord = acme()): Promise<void> =>
    handleMetaEvents(account, { statuses, accountEvents }, { db, scheduler });
  const alertsOf = async (account: WhatsAppAccountRecord) => (await db.getWhatsAppAccount(account.client_id, account.id))?.alerts ?? [];
  const failuresOf = async (phone: string) => {
    const n = world.number(phone);
    return (await db.getWhatsAppNumber(n.client_id, n.id))?.delivery_failures;
  };

  it('valeurs de la tâche 0 (f1)', () => {
    expect(ACCOUNT_ALERT_CODES).toEqual({ 131042: 'payment', 131031: 'account_locked', 368: 'policy_block' });
  });

  it('statut failed 131042 : delivery_failures à 1 et alerte payment sur le compte', async () => {
    await run([failed(ACME_PNID, [131042])]);
    expect(await failuresOf(ACME_NUMBER)).toBe(1);
    const n = await db.getWhatsAppNumber('acme', world.number(ACME_NUMBER).id);
    expect(n?.last_delivery_error_code).toBe(131042);
    expect(await alertsOf(acme())).toEqual([expect.objectContaining({ kind: 'payment', code: 131042, event: null })]);
  });

  it.each([[131031, 'account_locked'], [368, 'policy_block']] as const)('code %i : alerte %s', async (code, kind) => {
    await run([failed(ACME_PNID, [code])]);
    expect((await alertsOf(acme())).map((a) => a.kind)).toEqual([kind]);
  });

  it('échec sans code d\'alerte : compteur incrémenté, aucune alerte', async () => {
    await run([failed(ACME_PNID, [131026]), failed(ACME_PNID, [])]);
    expect(await failuresOf(ACME_NUMBER)).toBe(2);
    expect(await alertsOf(acme())).toEqual([]);
  });

  it('statut non failed : rien n\'est écrit', async () => {
    await run([{ recipientId: ACME_PNID, providerAccountId: ACME_WABA, status: 'delivered', errorCodes: [] }]);
    expect(await failuresOf(ACME_NUMBER)).toBe(0);
    expect(await alertsOf(acme())).toEqual([]);
  });

  it('rafale de statuts failed 131042 : une seule alerte par lot, tous les échecs comptés', async () => {
    await run(Array.from({ length: 30 }, () => failed(ACME_PNID, [131042])));
    expect(await failuresOf(ACME_NUMBER)).toBe(30);
    expect(await alertsOf(acme())).toHaveLength(1);
  });

  // isolation : audit 1.1 (une écriture ne traverse pas la frontière d'un compte ni d'une organisation)
  it("statut d'un phone_number_id d'un autre compte (même organisation ou autre organisation) : rien n'est écrit", async () => {
    await run([failed(ACME_SUPPORT_PNID, [131042]), failed(BETA_PNID, [131042]), failed('PNID_INCONNU', [368])]);
    expect(await failuresOf(ACME_NUMBER)).toBe(0);
    for (const account of [world.accounts.acmeMeta2.account, world.accounts.betaMeta.account, acme()]) {
      expect(await alertsOf(account)).toEqual([]);
    }
    for (const phone of Object.keys(world.accounts.acmeMeta2.numbers).concat(Object.keys(world.accounts.betaMeta.numbers))) {
      expect(await failuresOf(phone)).toBe(0);
    }
    expect(schedule).not.toHaveBeenCalled();
  });

  it("entrées d'une autre WABA ignorées : ni statut, ni alerte, ni rafraîchissement", async () => {
    await run(
      [failed(ACME_PNID, [131042], BETA_WABA)],
      [{ field: 'account_update', entryId: BETA_WABA, event: 'ACCOUNT_DELETED' }, { field: 'phone_number_quality_update', entryId: BETA_WABA }],
    );
    expect(await failuresOf(ACME_NUMBER)).toBe(0);
    expect(await alertsOf(acme())).toEqual([]);
    expect(schedule).not.toHaveBeenCalled();
  });

  it('account_update : alerte account_update avec l\'événement, rafraîchissement demandé pour ce compte', async () => {
    await run([], [{ field: 'account_update', entryId: ACME_WABA, event: 'ACCOUNT_RESTRICTION' }]);
    expect(await alertsOf(acme())).toEqual([expect.objectContaining({ kind: 'account_update', code: null, event: 'ACCOUNT_RESTRICTION' })]);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith('acme', acme().id);
  });

  it('account_update sans événement lisible : alerte avec event null', async () => {
    await run([], [{ field: 'account_update', entryId: ACME_WABA }]);
    expect(await alertsOf(acme())).toEqual([expect.objectContaining({ kind: 'account_update', event: null })]);
  });

  it('champ phone_number_* : rafraîchissement sans alerte ; autre champ : rien', async () => {
    await run([], [{ field: 'phone_number_quality_update', entryId: ACME_WABA, event: 'ONBOARDING' }, { field: 'phone_number_name_update', entryId: ACME_WABA }]);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(await alertsOf(acme())).toEqual([]);
    schedule.mockClear();
    await run([], [{ field: 'message_template_status_update', entryId: ACME_WABA }, { field: 'xphone_number_', entryId: ACME_WABA }]);
    expect(schedule).not.toHaveBeenCalled();
  });

  it('une erreur d\'écriture n\'empêche ni les autres écritures ni le rafraîchissement, sans donnée brute au journal', async () => {
    vi.spyOn(db, 'recordDeliveryFailure').mockRejectedValueOnce(new Error('base indisponible'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await run([failed(ACME_PNID, [131042]), failed(ACME_PNID, [131042])], [{ field: 'account_update', entryId: ACME_WABA }]);
    expect(await failuresOf(ACME_NUMBER)).toBe(1);
    expect(schedule).toHaveBeenCalledTimes(1);
    const lines = error.mock.calls.map((args) => args.map(String).join(' '));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`compte ${acme().id}`);
    expect(lines[0]).not.toContain(ACME_PNID);
  });

  // spec §7.4 : le rafraîchissement déclenché par un événement met en pause l'agent IA d'un numéro retiré
  describe('rafraîchissement déclenché par un événement', () => {
    it("un numéro retiré : son agent IA active passe paused (number_removed), celui d'une autre organisation est intact", async () => {
      const kept: ProviderNumber = {
        provider_number_id: ACME_FREE_PNID, phone_e164: ACME_FREE_NUMBER, display_name: ACME_FREE_NUMBER, meta_status: 'CONNECTED',
        quality: 'GREEN', is_test: false, cm_channel_id: null,
      };
      const providers = {
        verifyMeta: vi.fn(), verifyCm: vi.fn(), listCm: vi.fn(),
        listMeta: vi.fn(async () => ({ numbers: [kept], skipped: { sandbox: 0, invalid_number: 0 } })),
        metaWebhooks: fakeMetaWebhooks(),
      };
      const service = new WhatsAppAccountService({ db, providers });
      const refreshes: Array<Promise<void>> = [];
      const real = createRefreshScheduler((clientId, id) => {
        const done = service.refreshNumbers(clientId, id, null).then(() => undefined);
        refreshes.push(done);
        return done;
      });
      try {
        expect((await db.getBotRecord('acme', 'ventes'))?.status).toBe('active');
        await handleMetaEvents(
          acme(),
          { statuses: [], accountEvents: [{ field: 'phone_number_quality_update', entryId: ACME_WABA, event: 'ONBOARDING' }] },
          { db, scheduler: real },
        );
        await Promise.all(refreshes);
        expect(refreshes).toHaveLength(1);
        expect(await db.getBotRecord('acme', 'ventes')).toMatchObject({ status: 'paused', status_reason: 'number_removed' });
        expect(await db.getBotRecord('beta', 'accueil')).toMatchObject({ status: 'active', status_reason: null });
        expect(await db.getBotRecord('acme', 'support')).toMatchObject({ status: 'active', status_reason: null });
        expect(providers.listMeta).toHaveBeenCalledTimes(1);
      } finally {
        real.stop();
      }
    });
  });
});
