// Vue du numéro branché sur un agent IA (détail de l'agent IA, santé) et état affiché d'un compte WhatsApp.
// Lectures filtrées par l'organisation : un numéro ou un compte d'une autre organisation n'est jamais lu.

import type { BotNumberSummary, WhatsAppAccountErrorCauseView, WhatsAppAccountErrorReasonView, WhatsAppAccountStateView } from '@wabagent/contracts';
import type { Database } from '../database/types.js';
import type { WhatsAppAccountRecord } from '../database/whatsapp-types.js';
import { isSignatureRejected } from '../../webhooks/signature-monitor.js';

/**
 * État affiché d'un compte : signatures rejetées en série, il compte comme en erreur (choix 4), sans que l'état
 * stocké soit touché. C'est aussi l'état vu par la machine d'états (`isAccountBlocked: isSignatureRejected`).
 */
export function displayedAccountState(account: WhatsAppAccountRecord): {
  state: WhatsAppAccountStateView; error_reason: WhatsAppAccountErrorReasonView | null;
} {
  const blocked = account.state === 'connected' && isSignatureRejected(account.id);
  return blocked ? { state: 'error', error_reason: 'signature_rejected' } : { state: account.state, error_reason: account.error_reason };
}

/** Texte neutre d'un compte ou d'une app qui ne peut pas être raccordé : seule cause qui renvoie au support. */
export const CANNOT_CONNECT = 'Ce compte ne peut pas être raccordé. Contactez le support.';

/**
 * Motif et cause d'une erreur, lus de l'état stocké seulement (jamais d'un compte connecté, déconnecté, ou en erreur
 * affichée à cause de signatures rejetées). Source unique de la vue du compte et du résumé de numéro d'un agent IA.
 * Une panne du fournisseur ne met jamais le compte en erreur (vérification non concluante) : deux causes existent.
 */
export function storedErrorFields(account: WhatsAppAccountRecord): {
  error_detail: string | null; error_cause: WhatsAppAccountErrorCauseView | null;
} {
  if (account.state !== 'error') return { error_detail: null, error_cause: null };
  return { error_detail: account.error_detail, error_cause: account.error_detail === CANNOT_CONNECT ? 'support' : 'credentials' };
}

/** Numéro branché sur l'agent IA (présent ou retiré) avec son compte, ou null s'il n'en a pas. */
export async function loadBotNumberSummary(db: Database, clientId: string, botId: string): Promise<BotNumberSummary | null> {
  const number = await db.getWhatsAppNumberForBot(clientId, botId);
  if (!number) return null;
  const account = await db.getWhatsAppAccount(clientId, number.account_id);
  if (!account) return null; // impossible : la déconnexion supprime les numéros du compte
  return {
    id: number.id,
    phone_e164: number.phone_e164,
    display_name: number.display_name,
    is_test: number.is_test,
    provider_state: number.provider_state,
    quality: number.quality,
    delivery_failures: number.delivery_failures,
    last_delivery_error_code: number.last_delivery_error_code,
    account: { id: account.id, name: account.name, mode: account.mode, ...displayedAccountState(account), ...storedErrorFields(account) },
  };
}
