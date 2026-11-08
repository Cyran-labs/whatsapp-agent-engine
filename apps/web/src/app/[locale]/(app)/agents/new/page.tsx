'use client';

import { useSearchParams } from 'next/navigation';
import { TopBar } from '@/components/shell/top-bar';
import { Wizard } from '@/components/wizard/wizard';
import { parseEntityId } from '@/lib/entities';

export default function NewAgentPage() {
  const searchParams = useSearchParams();
  const initialEntityId = parseEntityId(searchParams?.get('entity') ?? null);
  return (
    <>
      <TopBar active="agents" />
      <main><Wizard initialEntityId={initialEntityId} /></main>
    </>
  );
}
