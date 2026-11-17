// Plan d'inventaire d'un compte WhatsApp (spec §6 unicité et reprise, §7.4). Fonction pure :
// le pilote lit `own` et `holders` dans sa transaction, appelle planInventory, applique le plan.

import type { DisplayNameRequestView } from '@wabagent/contracts';
import type { ProviderNumber, WhatsAppAccountState, WhatsAppNumberRecord } from '../core/database/whatsapp-types.js';

export interface InventoryPlan {
  /** Numéros neufs à insérer pour ce compte (après les reprises). */
  inserts: ProviderNumber[];
  /** Lignes du compte retrouvées chez le fournisseur ; `revive` si la ligne était retirée. */
  updates: Array<{ id: number; values: ProviderNumber; revive: boolean }>;
  /** Lignes présentes du compte que le fournisseur ne déclare plus. */
  removals: number[];
  /** Lignes vivantes d'autres comptes (en `error` ou `disconnected`) que ce compte reprend (action d'admin seulement). */
  takeovers: number[];
  /** Numéros tenus par un autre compte (`connected`, ou tout autre état sans reprise permise) : ni insérés ni repris. */
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
 * `disconnected`, il est repris seulement si `allowTakeover` (action d'un admin : raccordement, remplacement des
 * identifiants, « Rafraîchir les numéros »), refusé sinon : un événement du fournisseur ne reprend jamais un numéro
 * (revue 2b-2 I-1). Deux numéros déclarés qui partagent une clé ne comptent qu'une fois.
 */
export function planInventory(input: {
  accountId: number;
  own: WhatsAppNumberRecord[];
  holders: InventoryHolder[];
  found: ProviderNumber[];
  /** Défaut : false (aucune reprise). */
  allowTakeover?: boolean;
}): InventoryPlan {
  const allowTakeover = input.allowTakeover ?? false;
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
    if (conflicts.length > 0 && (!allowTakeover || conflicts.some((h) => h.holder_account_state === 'connected'))) {
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

/** Délai d'application d'un nom approuvé : approbation plus 14 jours (spec R2a §6.3). */
export const NAME_APPLY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** Nom affiché, demande de nom et code d'un numéro tels que l'inventaire les écrit (lot R2a). */
export interface NumberNameState {
  display_name: string;
  name_request: DisplayNameRequestView | null;
  pin_enabled: boolean | null;
}

/**
 * Réconcilie la demande de nom gardée en base avec celle que le fournisseur déclare (spec R2a §6.3 et §13.1, rulings
 * R-1, R-19, R-20). Fonction pure : `stored` est la ligne du compte retrouvée (absente pour un numéro neuf), `now` la
 * date de la relecture.
 * - `metaManaged` faux (CM.com) : ni demande ni code, toujours nuls.
 * - Meta ne dit aucune demande : la demande gardée est effacée et le nom affiché est celui de Meta (`verified_name`),
 *   qu'il soit devenu le nom demandé (appliqué hors de WABAGENT) ou non (demande expirée ou retirée).
 * - En revue ou refusée : l'état de Meta, avec la date de demande gardée pour le même nom.
 * - Approuvée, à appliquer : la date d'approbation est celle de Meta si elle en donne une, sinon celle de la première
 *   relecture qui l'observe (`apply_before_approx`), et une relecture suivante ne la déplace pas. Le nom affiché reste
 *   celui en base (ruling R-1) : un nom approuvé non appliqué n'est jamais le nom affiché. Numéro neuf : nom de Meta, sauf
 *   s'il est le nom approuvé, auquel cas le numéro lui-même.
 * Le code (`pin_enabled`) est celui du fournisseur à chaque relecture : nul reste nul, jamais false.
 */
export function reconcileNameState(
  stored: Pick<WhatsAppNumberRecord, 'display_name' | 'name_request'> | undefined, found: ProviderNumber, now: Date, metaManaged: boolean,
): NumberNameState {
  if (!metaManaged) return { display_name: found.display_name, name_request: null, pin_enabled: null };
  const meta = found.name_request;
  const pin_enabled = found.pin_enabled;
  if (meta === null) return { display_name: found.display_name, name_request: null, pin_enabled };
  const kept = stored?.name_request ?? null;
  const same = kept !== null && kept.requested_name === meta.requested_name ? kept : null;
  const base = { ...meta, requested_at: same?.requested_at ?? meta.requested_at };
  if (meta.status !== 'approved_pending') {
    return {
      display_name: found.display_name, pin_enabled,
      name_request: { ...base, approved_at: null, apply_before: null, apply_before_approx: false },
    };
  }
  const observed = same !== null && same.status === 'approved_pending' && same.approved_at !== null ? same : null;
  const approval = observed !== null
    ? { approved_at: observed.approved_at, apply_before: observed.apply_before, apply_before_approx: observed.apply_before_approx }
    : approvalFrom(meta.approved_at ?? now.toISOString(), meta.approved_at === null);
  const display_name = stored?.display_name
    ?? (found.display_name === meta.requested_name ? found.phone_e164 : found.display_name);
  return { display_name, pin_enabled, name_request: { ...base, ...approval } };
}

function approvalFrom(approvedAt: string, approx: boolean): Pick<DisplayNameRequestView, 'approved_at' | 'apply_before' | 'apply_before_approx'> {
  const at = Date.parse(approvedAt);
  return {
    approved_at: approvedAt,
    apply_before: Number.isNaN(at) ? null : new Date(at + NAME_APPLY_WINDOW_MS).toISOString(),
    apply_before_approx: approx,
  };
}
