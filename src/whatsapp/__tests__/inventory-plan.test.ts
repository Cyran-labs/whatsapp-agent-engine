import { describe, expect, it } from 'vitest';
import { planInventory } from '../inventory-plan.js';
import type { ProviderNumber, WhatsAppAccountState, WhatsAppNumberRecord } from '../../core/database/whatsapp-types.js';

function found(over: Partial<ProviderNumber> = {}): ProviderNumber {
  return {
    provider_number_id: 'pn-1', phone_e164: '+33100000001', display_name: 'Boutique', meta_status: 'CONNECTED',
    quality: 'GREEN', is_test: false, cm_channel_id: null, ...over,
  };
}

function row(over: Partial<WhatsAppNumberRecord> = {}): WhatsAppNumberRecord {
  return {
    id: 1, account_id: 10, client_id: 'acme', phone_e164: '+33100000001', provider_number_id: 'pn-1', cm_channel_id: null,
    display_name: 'Boutique', meta_status: 'CONNECTED', quality: 'GREEN', is_test: false, bot_id: null,
    provider_state: 'present', removed_at: null, delivery_failures: 0, last_delivery_error_code: null,
    last_delivery_error_at: null, created_at: '2026-11-08T10:00:00.000Z', updated_at: '2026-11-08T10:00:00.000Z', ...over,
  };
}

function holder(state: WhatsAppAccountState, over: Partial<WhatsAppNumberRecord> = {}): WhatsAppNumberRecord & { holder_account_state: WhatsAppAccountState } {
  return { ...row({ id: 50, account_id: 99, client_id: 'acme', ...over }), holder_account_state: state };
}

describe('planInventory (spec §6, §7.4)', () => {
  it('un numéro neuf est inséré', () => {
    expect(planInventory({ accountId: 20, own: [], holders: [], found: [found()] })).toEqual({
      inserts: [found()], updates: [], removals: [], takeovers: [], refused: 0,
    });
  });

  // audit 1.5
  it("un numéro tenu par un compte connected d'un autre compte est refusé et non inséré", () => {
    const plan = planInventory({ accountId: 20, own: [], holders: [holder('connected')], found: [found()] });
    expect(plan).toEqual({ inserts: [], updates: [], removals: [], takeovers: [], refused: 1 });
  });

  it('refusé aussi quand le détenteur ne partage que le numéro E.164 ou que l\'identifiant fournisseur', () => {
    expect(planInventory({ accountId: 20, own: [], holders: [holder('connected', { provider_number_id: 'autre' })], found: [found()] }).refused).toBe(1);
    expect(planInventory({ accountId: 20, own: [], holders: [holder('connected', { phone_e164: '+33199999999' })], found: [found()] }).refused).toBe(1);
  });

  it.each(['error', 'disconnected'] as const)('reprise permise (action d\'admin) : un numéro tenu par un compte %s est repris puis inséré', (state) => {
    const plan = planInventory({ accountId: 20, own: [], holders: [holder(state)], found: [found()], allowTakeover: true });
    expect(plan).toEqual({ inserts: [found()], updates: [], removals: [], takeovers: [50], refused: 0 });
  });

  // revue 2b-2 I-1
  it.each([
    ['error', undefined], ['disconnected', undefined], ['error', false], ['disconnected', false],
  ] as const)('sans reprise permise : un numéro tenu par un compte %s est refusé, ni repris ni inséré (allowTakeover %s)', (state, allowTakeover) => {
    const plan = planInventory({
      accountId: 20, own: [row({ id: 1, account_id: 20, phone_e164: '+33100000005', provider_number_id: 'pn-5' })],
      holders: [holder(state)], found: [found(), found({ phone_e164: '+33100000005', provider_number_id: 'pn-5' })],
      ...(allowTakeover === undefined ? {} : { allowTakeover }),
    });
    expect(plan).toMatchObject({ inserts: [], removals: [], takeovers: [], refused: 1 });
    expect(plan.updates.map((u) => u.id)).toEqual([1]);
  });

  it("un détenteur connected l'emporte sur un détenteur en erreur : refus, aucune reprise", () => {
    const plan = planInventory({
      accountId: 20, own: [], allowTakeover: true,
      holders: [holder('error', { id: 51, provider_number_id: 'autre' }), holder('connected', { id: 52, phone_e164: '+33199999999' })],
      found: [found()],
    });
    expect(plan).toEqual({ inserts: [], updates: [], removals: [], takeovers: [], refused: 1 });
  });

  it('un numéro de own absent de found est retiré ; un numéro déjà retiré ne l\'est pas deux fois', () => {
    const plan = planInventory({
      accountId: 10,
      own: [row({ id: 1 }), row({ id: 2, phone_e164: '+33100000002', provider_number_id: 'pn-2', provider_state: 'removed' })],
      holders: [], found: [],
    });
    expect(plan).toEqual({ inserts: [], updates: [], removals: [1], takeovers: [], refused: 0 });
  });

  it('un numéro présent retrouvé est mis à jour, sans être ravivé', () => {
    const f = found({ display_name: 'Nouveau nom', quality: 'RED' });
    const plan = planInventory({ accountId: 10, own: [row({ id: 1 })], holders: [], found: [f] });
    expect(plan).toEqual({ inserts: [], updates: [{ id: 1, values: f, revive: false }], removals: [], takeovers: [], refused: 0 });
  });

  it('un numéro retiré retrouvé est ravivé', () => {
    const plan = planInventory({ accountId: 10, own: [row({ id: 1, provider_state: 'removed' })], holders: [], found: [found()] });
    expect(plan).toEqual({ inserts: [], updates: [{ id: 1, values: found(), revive: true }], removals: [], takeovers: [], refused: 0 });
  });

  it('un numéro retiré retrouvé mais tenu entre-temps par un compte connected reste retiré', () => {
    const plan = planInventory({
      accountId: 10, own: [row({ id: 1, provider_state: 'removed' })], holders: [holder('connected')], found: [found()],
    });
    expect(plan).toEqual({ inserts: [], updates: [], removals: [], takeovers: [], refused: 1 });
  });

  it('la ligne présente est préférée à une ancienne ligne retirée du même numéro', () => {
    const plan = planInventory({
      accountId: 10,
      own: [row({ id: 1, provider_state: 'removed' }), row({ id: 2 })],
      holders: [], found: [found()],
    });
    expect(plan.updates).toEqual([{ id: 2, values: found(), revive: false }]);
    expect(plan.removals).toEqual([]);
  });

  it('deux lignes found identiques ne produisent qu\'une insertion', () => {
    const plan = planInventory({ accountId: 20, own: [], holders: [], found: [found(), found()] });
    expect(plan.inserts).toEqual([found()]);
  });

  it('deux lignes found qui partagent un identifiant ne produisent qu\'une insertion', () => {
    const plan = planInventory({ accountId: 20, own: [], holders: [], found: [found(), found({ provider_number_id: 'pn-x' })] });
    expect(plan.inserts).toEqual([found()]);
  });

  it('un détenteur repris par deux numéros found n\'est repris qu\'une fois', () => {
    const plan = planInventory({
      accountId: 20, own: [], allowTakeover: true,
      holders: [holder('error', { id: 50 })],
      found: [found(), found({ provider_number_id: 'pn-x', phone_e164: '+33100000001' })],
    });
    expect(plan.takeovers).toEqual([50]);
    expect(plan.inserts).toHaveLength(1);
  });
});
