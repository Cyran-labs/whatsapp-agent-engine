'use client';

import { useSearchParams } from 'next/navigation';
import { useSession } from '@/components/providers/session-provider';
import { ReservedPage } from '@/components/shell/reserved-page';
import { Wizard } from '@/components/wizard/wizard';
import { parseAgentFilter } from '@/lib/agents-filter';

export default function NewAgentPage() {
  const { isAdmin, readOnly } = useSession();
  const canCreate = isAdmin && !readOnly;
  const searchParams = useSearchParams();
  // Liste d'où l'on vient (recette 3.14, C-7) : le bouton rond d'une liste ouvre l'assistant suivi de son filtre ; une
  // valeur invalide donne toute la liste. L'entité n'est préremplie que pour une liste filtrée par entité.
  const origin = parseAgentFilter(new URLSearchParams(searchParams?.toString() ?? ''));
  const initialEntityId = origin.kind === 'entity' ? origin.entityId : null;

  // prototype 5 : refus sur place (spec 10.6) à la même adresse, jamais une redirection silencieuse. L'UI masque, le
  // moteur refuse.
  if (!canCreate) return <ReservedPage />;
  // Cadre normal (spec 12.1) : l'assistant pose lui-même le rail, sa colonne et son en-tête, qui suivent son état.
  return <Wizard initialEntityId={initialEntityId} origin={origin} />;
}
