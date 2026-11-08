'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from '@/i18n/routing';
import { useSession } from '@/components/providers/session-provider';
import { activeEntities, type EntitySummary } from '@/lib/entities';
import { TopBar } from '@/components/shell/top-bar';
import { PageShell } from '@/components/shell/page-shell';
import { OrganisationRail } from '@/components/organisation/organisation-rail';
import { OrganisationCountsContext } from '@/components/organisation/organisation-counts';
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
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshCounts = useCallback(() => setRefreshKey((k) => k + 1), []);
  const countsContext = useMemo(() => ({ refreshCounts }), [refreshCounts]);

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
    // Compteur Utilisateurs du rail : membres + invitations en attente.
    Promise.all([
      apiFetch('/api/users').then((r) => (r.ok ? (r.json() as Promise<unknown[]>) : null)),
      apiFetch('/api/invitations').then((r) => (r.ok ? (r.json() as Promise<Array<{ accepted_at: string | null }>>) : null)),
    ])
      .then(([members, invitations]) => {
        if (!alive) return;
        if (members && invitations) setUserCount(members.length + invitations.filter((i) => i.accepted_at === null).length);
        else setUserCount((current) => current ?? null);
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
    <>
      <TopBar active="organisation" />
      <PageShell rail={<OrganisationRail activeKey={activeKey} counts={{ entities: entityCount, users: userCount }} />}>
        <OrganisationCountsContext.Provider value={countsContext}>{children}</OrganisationCountsContext.Provider>
      </PageShell>
    </>
  );
}
