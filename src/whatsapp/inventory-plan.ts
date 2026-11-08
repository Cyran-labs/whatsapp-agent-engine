// Plan d'inventaire d'un compte WhatsApp (spec §6 unicité et reprise, §7.4). Fonction pure :
// le pilote lit `own` et `holders` dans sa transaction, appelle planInventory, applique le plan.

import type { ProviderNumber, WhatsAppAccountState, WhatsAppNumberRecord } from '../core/database/whatsapp-types.js';

export interface InventoryPlan {
  /** Numéros neufs à insérer pour ce compte (après les reprises). */
  inserts: ProviderNumber[];
  /** Lignes du compte retrouvées chez le fournisseur ; `revive` si la ligne était retirée. */
  updates: Array<{ id: number; values: ProviderNumber; revive: boolean }>;
  /** Lignes présentes du compte que le fournisseur ne déclare plus. */
  removals: number[];
  /** Lignes vivantes d'autres comptes (en `error` ou `disconnected`) que ce compte reprend. */
  takeovers: number[];
  /** Numéros tenus par un compte `connected` d'un autre compte : ni insérés ni repris. */
  refused: number;
}

export type InventoryHolder = WhatsAppNumberRecord & { holder_account_state: WhatsAppAccountState };

function sameNumber(a: { phone_e164: string; provider_number_id: string }, b: { phone_e164: string; provider_number_id: string }): boolean {
  return a.phone_e164 === b.phone_e164 || a.provider_number_id === b.provider_number_id;
}

/**
 * Ligne du compte qui correspond à un numéro déclaré : la ligne présente d'abord (par identifiant fournisseur,
 * puis par numéro E.164), sinon la ligne retirée la plus récente.
 */
function matchOwn(own: WhatsAppNumberRecord[], f: ProviderNumber, taken: Set<number>): WhatsAppNumberRecord | undefined {
  const free = own.filter((r) => !taken.has(r.id));
  const byRecency = (rows: WhatsAppNumberRecord[]): WhatsAppNumberRecord | undefined =>
    rows.slice().sort((x, y) => y.id - x.id)[0];
  for (const state of ['present', 'removed'] as const) {
    const rows = free.filter((r) => r.provider_state === state);
    const hit = byRecency(rows.filter((r) => r.provider_number_id === f.provider_number_id))
      ?? byRecency(rows.filter((r) => r.phone_e164 === f.phone_e164));
    if (hit) return hit;
  }
  return undefined;
}

/**
 * `own` : toutes les lignes du compte (présentes et retirées). `holders` : lignes présentes d'autres comptes
 * qui partagent un numéro E.164 ou un identifiant fournisseur avec `found`, avec l'état de leur compte.
 * Un numéro tenu par un compte `connected` est refusé (audit 1.5) ; tenu par un compte `error` ou
 * `disconnected`, il est repris. Deux numéros déclarés qui partagent une clé ne comptent qu'une fois.
 */
export function planInventory(input: {
  accountId: number;
  own: WhatsAppNumberRecord[];
  holders: InventoryHolder[];
  found: ProviderNumber[];
}): InventoryPlan {
  const plan: InventoryPlan = { inserts: [], updates: [], removals: [], takeovers: [], refused: 0 };
  const seen: ProviderNumber[] = [];
  const matched = new Set<number>();
  const takeovers = new Set<number>();

  for (const f of input.found) {
    if (seen.some((s) => sameNumber(s, f))) continue;
    seen.push(f);

    const mine = matchOwn(input.own, f, matched);
    if (mine) matched.add(mine.id);

    const conflicts = input.holders.filter((h) => sameNumber(h, f));
    if (conflicts.some((h) => h.holder_account_state === 'connected')) {
      plan.refused += 1;
      continue;
    }
    for (const h of conflicts) takeovers.add(h.id);

    if (mine) plan.updates.push({ id: mine.id, values: f, revive: mine.provider_state === 'removed' });
    else plan.inserts.push(f);
  }

  plan.removals = input.own
    .filter((r) => r.provider_state === 'present' && !matched.has(r.id))
    .map((r) => r.id);
  plan.takeovers = [...takeovers];
  return plan;
}
