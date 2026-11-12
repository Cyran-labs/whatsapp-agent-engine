/**
 * Vue d'un agent IA pour le membre qui la lit (spec navigation 9.2) : la liste d'accès limité contient des numéros de
 * contacts (E.164 ou BSUID), masqués par `maskContactNumber` quand `canSeeContactNumbers` est faux. Appelée par les
 * lectures `GET /bots` et `GET /bots/:botId` seulement : les réponses des écritures vont à l'admin (`bots.configure`)
 * et restent entières. Le numéro de l'agent IA (`whatsapp_number`) n'est jamais masqué.
 */
import { maskContactNumber } from '@wabagent/contracts';
import { canSeeContactNumbers, type Access } from './permissions.js';

export function presentBotForViewer<T extends { allowlist: string[]; entity_id: number | null }>(bot: T, access: Access): T {
  if (canSeeContactNumbers(access, bot.entity_id)) return bot;
  return { ...bot, allowlist: bot.allowlist.map(maskContactNumber) };
}
