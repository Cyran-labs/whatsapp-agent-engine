import { describe, expect, it } from 'vitest';
import { planInventory, reconcileNameState } from '../inventory-plan.js';
import type { DisplayNameRequestView } from '@wabagent/contracts';
import type { ProviderNumber, WhatsAppAccountState, WhatsAppNumberRecord } from '../../core/database/whatsapp-types.js';

function found(over: Partial<ProviderNumber> = {}): ProviderNumber {
  return {
    provider_number_id: 'pn-1', phone_e164: '+33100000001', display_name: 'Boutique', meta_status: 'CONNECTED',
    quality: 'GREEN', is_test: false, cm_channel_id: null, name_request: null, pin_enabled: null, name_status: null, ...over,
  };
}

function row(over: Partial<WhatsAppNumberRecord> = {}): WhatsAppNumberRecord {
  return {
    id: 1, account_id: 10, client_id: 'acme', phone_e164: '+33100000001', provider_number_id: 'pn-1', cm_channel_id: null,
    display_name: 'Boutique', meta_status: 'CONNECTED', quality: 'GREEN', is_test: false, bot_id: null,
    provider_state: 'present', removed_at: null, delivery_failures: 0, last_delivery_error_code: null,
    last_delivery_error_at: null, name_request: null, pin_enabled: null, name_status: null, created_at: '2026-11-08T10:00:00.000Z', updated_at: '2026-11-08T10:00:00.000Z', ...over,
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

// Spec R2a §6.3 : fonction pure partagée par les deux pilotes ; les parcours complets sont dans whatsapp-account-service.test.ts.
describe('reconcileNameState (lot R2a, spec §6.3)', () => {
  const NOW = new Date('2026-11-17T08:00:00.000Z');
  const request = (over: Partial<DisplayNameRequestView> = {}): DisplayNameRequestView => ({
    requested_name: 'Maison Acme', status: 'approved_pending', rejection_reason: null, requested_at: null,
    approved_at: null, apply_before: null, apply_before_approx: false, ...over,
  });

  it("date d'approbation portée par Meta : prise telle quelle, date limite exacte (pas « environ »)", () => {
    const state = reconcileNameState(row(), found({ name_request: request({ approved_at: '2026-11-15T12:00:00.000Z' }) }), NOW, true);
    expect(state.display_name).toBe('Boutique');
    expect(state.name_request).toMatchObject({
      approved_at: '2026-11-15T12:00:00.000Z', apply_before: '2026-11-29T12:00:00.000Z', apply_before_approx: false,
    });
  });

  it('approbation déjà observée pour un autre nom : nouvelle approbation, nouvelle date', () => {
    const stored = row({ name_request: request({ requested_name: 'Ancien', approved_at: '2026-11-01T00:00:00.000Z', apply_before: '2026-11-15T00:00:00.000Z', apply_before_approx: true }) });
    expect(reconcileNameState(stored, found({ name_request: request() }), NOW, true).name_request).toMatchObject({
      requested_name: 'Maison Acme', approved_at: NOW.toISOString(), apply_before: '2026-12-01T08:00:00.000Z', apply_before_approx: true,
    });
  });

  // Audit des décisions R2a, P-42 : une demande approuvée gardée qui disparaît chez Meta (EXPIRED ou absente) sans que
  // verified_name devienne le nom demandé laisse une trace `expired`, jamais présentée comme le nom affiché.
  it('approuvée gardée, Meta ne rend plus rien et le nom affiché n\'a pas changé : trace « expired » (audit P-42)', () => {
    const kept = request({ requested_at: '2026-11-01T09:00:00.000Z', approved_at: '2026-11-02T09:00:00.000Z', apply_before: '2026-11-16T09:00:00.000Z', apply_before_approx: true });
    const state = reconcileNameState(row({ name_request: kept }), found(), NOW, true);
    expect(state).toEqual({ display_name: 'Boutique', name_request: { ...kept, status: 'expired' }, pin_enabled: null, name_status: null });
    // La trace reste tant que Meta ne dit rien de nouveau, sans que le nom expiré devienne le nom affiché.
    const again = reconcileNameState(row({ name_request: state.name_request }), found(), NOW, true);
    expect(again).toEqual(state);
  });

  it('trace « expired » : effacée si le nom demandé devient le nom affiché, remplacée par une nouvelle demande (audit P-42)', () => {
    const expired = request({ status: 'expired', requested_at: '2026-11-01T09:00:00.000Z', approved_at: '2026-11-02T09:00:00.000Z' });
    expect(reconcileNameState(row({ name_request: expired }), found({ display_name: 'Maison Acme' }), NOW, true))
      .toEqual({ display_name: 'Maison Acme', name_request: null, pin_enabled: null, name_status: null });
    // Demande du même nom vue chez Meta : jamais la date de demande de l'ancienne demande expirée.
    expect(reconcileNameState(row({ name_request: expired }), found({ name_request: request({ status: 'in_review' }) }), NOW, true).name_request)
      .toEqual(request({ status: 'in_review' }));
    expect(reconcileNameState(row({ name_request: expired }), found({ name_request: request() }), NOW, true).name_request)
      .toMatchObject({ status: 'approved_pending', approved_at: NOW.toISOString(), apply_before_approx: true });
  });

  // Audit des décisions R2a, P-42 et M-g : une demande en revue écrite par WABAGENT (date de demande connue) que Meta ne
  // rend pas encore juste après l'envoi n'est pas effacée pendant quelques minutes.
  it('en revue écrite par WABAGENT il y a moins de 10 minutes, Meta ne la rend pas encore : gardée (audit M-g)', () => {
    const fresh = request({ status: 'in_review', requested_at: new Date(NOW.getTime() - 9 * 60 * 1000).toISOString() });
    expect(reconcileNameState(row({ name_request: fresh }), found(), NOW, true).name_request).toEqual(fresh);
    const old = request({ status: 'in_review', requested_at: new Date(NOW.getTime() - 11 * 60 * 1000).toISOString() });
    expect(reconcileNameState(row({ name_request: old }), found(), NOW, true).name_request).toBeNull();
    // Vue chez Meta seulement (sans date de demande) : effacée dès que Meta ne la rend plus.
    expect(reconcileNameState(row({ name_request: request({ status: 'in_review' }) }), found(), NOW, true).name_request).toBeNull();
    expect(reconcileNameState(row({ name_request: request({ status: 'rejected', requested_at: NOW.toISOString() }) }), found(), NOW, true).name_request).toBeNull();
  });

  it('compte CM.com : ni demande, ni code, ni état du nom, même si le fournisseur en rend', () => {
    expect(reconcileNameState(row(), found({ name_request: request(), pin_enabled: true, name_status: 'APPROVED' }), NOW, false))
      .toEqual({ display_name: 'Boutique', name_request: null, pin_enabled: null, name_status: null });
  });

  // Audit des décisions R2a, texte 3 : l'état du nom actuel est celui de Meta à chaque relecture, nul s'il n'est pas lu.
  it('état du nom actuel : celui de Meta à chaque relecture, nul s\'il n\'est pas lu (audit, texte 3)', () => {
    expect(reconcileNameState(row({ name_status: 'PENDING_REVIEW' }), found({ name_status: 'APPROVED' }), NOW, true).name_status).toBe('APPROVED');
    expect(reconcileNameState(row({ name_status: 'APPROVED' }), found(), NOW, true).name_status).toBeNull();
    expect(reconcileNameState(undefined, found({ name_status: 'DECLINED', name_request: request() }), NOW, true).name_status).toBe('DECLINED');
  });
});
