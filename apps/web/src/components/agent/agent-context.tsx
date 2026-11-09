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
