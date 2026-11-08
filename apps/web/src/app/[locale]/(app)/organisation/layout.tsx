'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from '@/i18n/routing';
import { useSession } from '@/components/providers/session-provider';
import { activeEntities, type EntitySummary } from '@/lib/entities';
import { TopBar } from '@/components/shell/top-bar';
import { PageShell } from '@/components/shell/page-shell';
import { OrganisationRail } from '@/components/organisation/organisation-rail';

export default function OrganisationLayout({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const [entityCount, setEntityCount] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (!isAdmin) routerRef.current.replace('/');
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    fetch('/api/entities')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: EntitySummary[] | null) => {
        if (alive && d) setEntityCount(activeEntities(d).length);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isAdmin]);

  if (!isAdmin) return null;

  const activeKey = pathname.split('/')[2] ?? 'entites';
  return (
    <>
      <TopBar active="organisation" />
      <PageShell rail={<OrganisationRail activeKey={activeKey} counts={{ entities: entityCount }} />}>
        {children}
      </PageShell>
    </>
  );
}
