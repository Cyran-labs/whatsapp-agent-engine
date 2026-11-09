'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * Identifiants dont une action est en cours (garde de double clic par ligne). `begin` renvoie faux si l'action de cet
 * identifiant est déjà en cours : l'appelant ne renvoie alors rien. `ids` sert à désactiver les boutons.
 */
export function useBusyIds() {
  const ref = useRef<Set<number>>(new Set());
  const [ids, setIds] = useState<ReadonlySet<number>>(new Set());
  const begin = useCallback((id: number): boolean => {
    if (ref.current.has(id)) return false;
    ref.current.add(id);
    setIds(new Set(ref.current));
    return true;
  }, []);
  const end = useCallback((id: number) => {
    ref.current.delete(id);
    setIds(new Set(ref.current));
  }, []);
  return { ids, begin, end };
}
