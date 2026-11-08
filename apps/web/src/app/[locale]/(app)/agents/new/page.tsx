'use client';

import { useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/i18n/routing';
import { useSession } from '@/components/providers/session-provider';
import { TopBar } from '@/components/shell/top-bar';
import { Wizard } from '@/components/wizard/wizard';
import { parseEntityId } from '@/lib/entities';

export default function NewAgentPage() {
  const { isAdmin, readOnly } = useSession();
  const canCreate = isAdmin && !readOnly;
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const searchParams = useSearchParams();
  const initialEntityId = parseEntityId(searchParams?.get('entity') ?? null);

  // Même garde que l'espace Organisation : l'UI masque, le moteur refuse.
  useEffect(() => {
    if (!canCreate) routerRef.current.replace('/');
  }, [canCreate]);

  if (!canCreate) return null;
  return (
    <>
      <TopBar active="agents" />
      <main><Wizard initialEntityId={initialEntityId} /></main>
    </>
  );
}
