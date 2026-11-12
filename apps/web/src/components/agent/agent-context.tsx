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

/** Lecture des entités de l'organisation par la mise en page (P9) : en cours, lue, ou en échec. */
export type EntityReadState = 'loading' | 'ready' | 'failed';

/**
 * Nom et statut de l'agent IA lus par la mise en page ; nul pendant la lecture, ou sans mise en page. `status_reason`
 * (motif brut d'Offline), `not_responding` (mention calculée par le moteur, brute, filtrée à l'affichage) et
 * `account_state` (état affiché du compte de son numéro, nul sans numéro) servent à la ligne de statut de la colonne (spec 7.3, point 4) ;
 * `entity_name` à la ligne « Entité · {nom} » de la colonne et au titre de la page (spec 10.3).
 */
export interface AgentInfo {
  /**
   * Lecture de l'agent IA en échec (introuvable dans l'organisation ouverte, ou panne) : `name` est alors l'identifiant
   * de l'adresse, jamais affiché ; la colonne et la page disent « Agent IA indisponible », avec « Agents IA » seul en
   * parents (spec en-tête 7.4, revue isolation entête M-4, recette phase E).
   */
  unavailable: boolean;
  name: string;
  status: string;
  status_reason: string | null;
  not_responding: string | null;
  account_state: WhatsAppAccountStateView | null;
  /** Entité de l'agent IA ; nulle si l'agent IA n'en a pas ou si sa lecture a échoué (C-5). */
  entity_id: number | null;
  /** Nom de l'entité de l'agent IA, lu de `/api/entities` par `entity_id` ; nul tant qu'il n'est pas lu, en échec ou introuvable. */
  entity_name: string | null;
  /** Où en est la lecture des entités de l'organisation : la ligne des parents en dépend (squelette, nom, ou rien). */
  entities: EntityReadState;
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
