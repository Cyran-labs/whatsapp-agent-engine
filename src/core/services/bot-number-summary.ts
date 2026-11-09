// Vue du numéro branché sur un agent IA (détail de l'agent IA, santé) et état affiché d'un compte WhatsApp.
// Lectures filtrées par l'organisation : un numéro ou un compte d'une autre organisation n'est jamais lu.

import type { BotNumberSummary, WhatsAppAccountErrorReasonView, WhatsAppAccountStateView } from '@wabagent/contracts';
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
    account: { id: account.id, name: account.name, mode: account.mode, ...displayedAccountState(account) },
  };
}
