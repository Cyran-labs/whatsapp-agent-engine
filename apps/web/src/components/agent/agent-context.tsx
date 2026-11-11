'use client';
import { createContext, useContext } from 'react';
import type { WhatsAppAccountStateView } from '@wabagent/contracts';
import type { BotView } from '@/lib/agent-types';

/**
 * La page de l'agent IA relit son agent IA après un changement de statut, de numéro ou de liste : elle le
 * signale à la mise en page, dont le rail affiche le nom et le statut. Sans mise en page, le signal est sans effet.
 */
const ReportBotContext = createContext<(bot: BotView) => void>(() => undefined);

export const ReportBotProvider = ReportBotContext.Provider;

export function useReportBot(): (bot: BotView) => void {
  return useContext(ReportBotContext);
}

/**
 * Nom et statut de l'agent IA lus par la mise en page ; nul pendant la lecture, ou sans mise en page. `status_reason`
 * (motif brut d'Offline), `not_responding` (mention calculée par le moteur, brute, filtrée à l'affichage) et
 * `account_state` (état affiché du compte de son numéro, nul sans numéro) servent à la ligne de statut de la colonne (spec 7.3, point 4).
 */
export interface AgentInfo {
  name: string;
  status: string;
  status_reason: string | null;
  not_responding: string | null;
  account_state: WhatsAppAccountStateView | null;
}

/**
 * La mise en page lit l'agent IA une fois et le partage : la colonne du milieu et le fil d'Ariane de chaque page
 * (spec refonte de la navigation, 5.3) nomment le même agent IA, d'une seule source.
 */
const AgentInfoContext = createContext<AgentInfo | null>(null);

export const AgentInfoProvider = AgentInfoContext.Provider;

export function useAgentInfo(): AgentInfo | null {
  return useContext(AgentInfoContext);
}
