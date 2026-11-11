'use client';

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { usePathname } from '@/i18n/routing';
import { useSession } from '@/components/providers/session-provider';
import type { WhatsAppAccountView } from '@wabagent/contracts';
import { activeEntities, type EntitySummary } from '@/lib/entities';
import { AppFrame } from '@/components/shell/app-frame';
import { ReservedPage } from '@/components/shell/reserved-page';
import { OrganisationRail, type OrganisationCounts } from '@/components/organisation/organisation-rail';
import { connectionCounts, OrganisationCountsContext, type ConnectionCounts } from '@/components/organisation/organisation-counts';
import { apiFetch, isOrgChanged } from '@/lib/api-fetch';

export default function OrganisationLayout({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useSession();
  // prototype 5 : l'espace Organisation est réservé à l'admin (spec 10.7). Un autre membre voit le refus sur place
  // (spec 10.6) à la même adresse, sans redirection ; ni la page ni les compteurs de la colonne ne sont lus.
  if (!isAdmin) return <ReservedPage />;
  return <OrganisationSpace>{children}</OrganisationSpace>;
}

function OrganisationSpace({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // undefined : en cours de chargement ; null : lecture impossible, le compteur n'est pas affiché.
  const [entityCount, setEntityCount] = useState<number | null | undefined>(undefined);
  const [userCount, setUserCount] = useState<number | null | undefined>(undefined);
  const [connections, setConnections] = useState<ConnectionCounts | null | undefined>(undefined);
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshCounts = useCallback(() => setRefreshKey((k) => k + 1), []);
  const reportConnections = useCallback((accounts: readonly Pick<WhatsAppAccountView, 'state'>[]) => setConnections(connectionCounts(accounts)), []);
  const countsContext = useMemo(() => ({ refreshCounts, reportConnections }), [refreshCounts, reportConnections]);

  useEffect(() => {
    let alive = true;
    /**
     * Lit une route et pose son compteur. 409 ORG_CHANGED (organisation changée dans un autre onglet) : apiFetch
     * recharge la page, le compteur repasse en chargement au lieu de garder celui de l'organisation précédente
     * (relecture tâche 10, m-5). Autre échec : le dernier compteur lu reste, sinon rien.
     */
    function read<T, C>(url: string, count: (body: T) => C, set: Dispatch<SetStateAction<C | null | undefined>>) {
      apiFetch(url)
        .then(async (r) => {
          if (await isOrgChanged(r)) {
            if (alive) set(undefined);
            return;
          }
          const body = r.ok ? ((await r.json()) as T) : null;
          if (alive) set((current) => (body !== null ? count(body) : (current ?? null)));
        })
        .catch(() => {
          if (alive) set((current) => current ?? null);
        });
    }
    read<EntitySummary[], number>('/api/entities', (d) => activeEntities(d).length, setEntityCount);
    // Entrée Connexions du rail : comptes WhatsApp non retirés et, parmi eux, comptes en erreur (prototype 17), d'une
    // même lecture.
    read<WhatsAppAccountView[], ConnectionCounts>('/api/whatsapp-accounts', connectionCounts, setConnections);
    // Compteur Utilisateurs du rail : les membres seulement, comme l'en-tête de la page (« 5 membres · 2 invitations
    // en attente ») ; les invitations en attente ne sont pas des utilisateurs de l'organisation.
    read<unknown[], number>('/api/users', (members) => members.length, setUserCount);
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  const activeKey = pathname.split('/')[2] ?? 'entites';
  const counts: OrganisationCounts = {
    entities: entityCount,
    users: userCount,
    connections: connections === undefined ? undefined : (connections?.live ?? null),
    connectionErrors: connections?.errors,
  };
  return (
    <AppFrame
      space="organisation"
      column={<OrganisationRail activeKey={activeKey} counts={counts} />}
    >
      <OrganisationCountsContext.Provider value={countsContext}>{children}</OrganisationCountsContext.Provider>
    </AppFrame>
  );
}
