'use client';

import { createContext, useContext } from 'react';

export interface OrganisationCountsContextValue {
  /** Relit les compteurs du rail (après création, archivage ou réactivation d'une entité). */
  refreshCounts: () => void;
}

export const OrganisationCountsContext = createContext<OrganisationCountsContextValue>({ refreshCounts: () => {} });

export function useOrganisationCounts(): OrganisationCountsContextValue {
  return useContext(OrganisationCountsContext);
}
