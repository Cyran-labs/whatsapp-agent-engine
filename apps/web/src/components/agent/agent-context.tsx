'use client';
import { createContext, useContext } from 'react';
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

/** Nom et statut de l'agent IA lus par la mise en page ; nul pendant la lecture, ou sans mise en page. */
export interface AgentInfo {
  name: string;
  status: string;
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
