'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from '@/i18n/routing';
import { useSession } from '@/components/providers/session-provider';
import type { WhatsAppAccountView } from '@wabagent/contracts';
import { activeEntities, type EntitySummary } from '@/lib/entities';
import { AppFrame } from '@/components/shell/app-frame';
import { OrganisationRail } from '@/components/organisation/organisation-rail';
import { connectionCounts, OrganisationCountsContext, type ConnectionCounts } from '@/components/organisation/organisation-counts';
import { apiFetch } from '@/lib/api-fetch';

export default function OrganisationLayout({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  // undefined : en cours de chargement ; null : lecture impossible, le compteur n'est pas affiché.
  const [entityCount, setEntityCount] = useState<number | null | undefined>(undefined);
  const [userCount, setUserCount] = useState<number | null | undefined>(undefined);
  const [connections, setConnections] = useState<ConnectionCounts | null | undefined>(undefined);
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshCounts = useCallback(() => setRefreshKey((k) => k + 1), []);
  const reportConnections = useCallback((accounts: readonly Pick<WhatsAppAccountView, 'state'>[]) => setConnections(connectionCounts(accounts)), []);
  const countsContext = useMemo(() => ({ refreshCounts, reportConnections }), [refreshCounts, reportConnections]);

  useEffect(() => {
    if (!isAdmin) routerRef.current.replace('/');
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    apiFetch('/api/entities')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: EntitySummary[] | null) => {
        if (alive) setEntityCount((current) => (d ? activeEntities(d).length : (current ?? null)));
      })
      .catch(() => {
        if (alive) setEntityCount((current) => current ?? null);
      });
    // Entrée Connexions du rail : comptes WhatsApp non retirés et, parmi eux, comptes en erreur (prototype 17), d'une
    // même lecture.
    apiFetch('/api/whatsapp-accounts')
      .then((r) => (r.ok ? (r.json() as Promise<WhatsAppAccountView[]>) : null))
      .then((d) => {
        if (alive) setConnections((current) => (d ? connectionCounts(d) : (current ?? null)));
      })
      .catch(() => {
        if (alive) setConnections((current) => current ?? null);
      });
    // Compteur Utilisateurs du rail : les membres seulement, comme l'en-tête de la page (« 5 membres · 2 invitations
    // en attente ») ; les invitations en attente ne sont pas des utilisateurs de l'organisation.
    apiFetch('/api/users')
      .then((r) => (r.ok ? (r.json() as Promise<unknown[]>) : null))
      .then((members) => {
        if (!alive) return;
        setUserCount((current) => (members ? members.length : (current ?? null)));
      })
      .catch(() => {
        if (alive) setUserCount((current) => current ?? null);
      });
    return () => {
      alive = false;
    };
  }, [isAdmin, refreshKey]);

  if (!isAdmin) return null;

  const activeKey = pathname.split('/')[2] ?? 'entites';
  return (
    <AppFrame
      space="organisation"
      column={<OrganisationRail activeKey={activeKey} counts={{
            entities: entityCount,
            users: userCount,
            connections: connections === undefined ? undefined : (connections?.live ?? null),
            connectionErrors: connections?.errors,
          }} />}
    >
      <OrganisationCountsContext.Provider value={countsContext}>{children}</OrganisationCountsContext.Provider>
    </AppFrame>
  );
}
