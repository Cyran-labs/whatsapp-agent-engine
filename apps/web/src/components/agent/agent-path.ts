/**
 * Vrai si `pathname` (sans la langue) est la page d'usage de l'agent IA `botId` : segment exact, jamais un simple
 * suffixe « /usage », pour que la Vue d'ensemble d'un agent IA d'identifiant « usage » ne soit pas lue comme sa page
 * d'usage (relecture tâche 11, M-1). L'identifiant est comparé encodé (adresse brute) et tel quel (adresse décodée).
 */
export function isAgentUsagePath(pathname: string, botId: string): boolean {
  return pathname === `/agents/${encodeURIComponent(botId)}/usage` || pathname === `/agents/${botId}/usage`;
}
