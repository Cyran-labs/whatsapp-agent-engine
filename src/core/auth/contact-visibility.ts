/**
 * Vue d'un agent IA pour le membre qui la lit (spec navigation 9.2) : la liste d'accès limité contient des numéros de
 * contacts (E.164 ou BSUID), masqués par `maskContactNumber` quand `canSeeContactNumbers` est faux. Le numéro de l'agent
 * IA (`whatsapp_number`) n'est jamais masqué ; la WABA et le portefeuille de son compte ne sont présentés qu'à qui a
 * `connections.manage` (ruling R-34, `presentNumberSummaryForViewer`). Appelée par toutes les réponses qui portent un
 * agent IA : pour l'admin (`bots.configure`), elles restent entières.
 */
import { maskContactNumber, type BotNumberSummary } from '@wabagent/contracts';
import { can, canSeeContactNumbers, type Access } from './permissions.js';

export function presentBotForViewer<T extends { allowlist: string[]; entity_id: number | null; whatsapp_number?: BotNumberSummary | null }>(
  bot: T, access: Access,
): T {
  const shown = bot.whatsapp_number === undefined ? bot : { ...bot, whatsapp_number: presentNumberSummaryForViewer(bot.whatsapp_number, access) };
  if (canSeeContactNumbers(access, bot.entity_id)) return shown;
  return { ...shown, allowlist: bot.allowlist.map(maskContactNumber) };
}

/**
 * Résumé du numéro d'un agent IA pour le membre qui le lit (ruling R-34, spec R2a §7 : ce lot n'ajoute aucune lecture
 * pour les autres rôles que l'administrateur). La WABA et le portefeuille Meta Business du compte (identifiant et nom)
 * ne sont présentés qu'avec `connections.manage` ; sinon ils valent null, comme pour un portefeuille jamais lu. Le reste
 * du résumé (numéro, état du compte, échecs de remise) est lu par tout membre, comme avant le lot.
 */
export function presentNumberSummaryForViewer(summary: BotNumberSummary | null, access: Access): BotNumberSummary | null {
  if (summary === null || can(access, 'connections.manage')) return summary;
  return { ...summary, account: { ...summary.account, waba_id: null, business: null } };
}
