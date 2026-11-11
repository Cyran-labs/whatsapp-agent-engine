'use client';

import { useSearchParams } from 'next/navigation';
import { useSession } from '@/components/providers/session-provider';
import { ReservedPage } from '@/components/shell/reserved-page';
import { Wizard } from '@/components/wizard/wizard';
import { parseEntityId } from '@/lib/entities';

export default function NewAgentPage() {
  const { isAdmin, readOnly } = useSession();
  const canCreate = isAdmin && !readOnly;
  const searchParams = useSearchParams();
  const initialEntityId = parseEntityId(searchParams?.get('entity') ?? null);

  // prototype 5 : refus sur place (spec 10.6) à la même adresse, jamais une redirection silencieuse. L'UI masque, le
  // moteur refuse.
  if (!canCreate) return <ReservedPage />;
  // Mode concentré (maquette 2) : la barre de l'assistant est la seule, sans barre de navigation au-dessus.
  return <main><Wizard initialEntityId={initialEntityId} /></main>;
}
