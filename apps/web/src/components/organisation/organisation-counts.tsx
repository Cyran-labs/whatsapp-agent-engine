'use client';

import { createContext, useContext } from 'react';

export interface OrganisationCountsContextValue {
  /** Relit les compteurs du rail (après création, archivage ou réactivation d'une entité). */
  refreshCounts: () => void;
  /**
   * La page Connexions lit déjà la liste des comptes : elle donne au rail le nombre de comptes non déconnectés au lieu
   * de lui faire relire la même route (revue finale 2b-3 m-2).
   */
  reportConnectionCount: (count: number) => void;
}

export const OrganisationCountsContext = createContext<OrganisationCountsContextValue>({ refreshCounts: () => {}, reportConnectionCount: () => {} });

export function useOrganisationCounts(): OrganisationCountsContextValue {
  return useContext(OrganisationCountsContext);
}
