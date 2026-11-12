'use client';

import { createContext, useContext } from 'react';
import type { WhatsAppAccountView } from '@wabagent/contracts';

/** Compteurs de l'entrée Connexions : comptes raccordés (non retirés) et, parmi eux, comptes en erreur. */
export interface ConnectionCounts {
  live: number;
  errors: number;
}

/** Source unique des deux compteurs, pour la lecture du gabarit et celle de la page Connexions. */
export function connectionCounts(accounts: readonly Pick<WhatsAppAccountView, 'state'>[]): ConnectionCounts {
  return {
    live: accounts.filter((a) => a.state !== 'disconnected').length,
    errors: accounts.filter((a) => a.state === 'error').length,
  };
}

export interface OrganisationCountsContextValue {
  /** Relit les compteurs du rail (après création, archivage ou réactivation d'une entité). */
  refreshCounts: () => void;
  /**
   * La page Connexions lit déjà la liste des comptes : elle la donne au rail (comptes raccordés et comptes en erreur)
   * au lieu de lui faire relire la même route (revue finale 2b-3 m-2).
   */
  reportConnections: (accounts: readonly Pick<WhatsAppAccountView, 'state'>[]) => void;
}

export const OrganisationCountsContext = createContext<OrganisationCountsContextValue>({ refreshCounts: () => {}, reportConnections: () => {} });

export function useOrganisationCounts(): OrganisationCountsContextValue {
  return useContext(OrganisationCountsContext);
}
