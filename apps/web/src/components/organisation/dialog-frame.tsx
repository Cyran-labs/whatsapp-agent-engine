'use client';

import { useEffect, useId, useRef } from 'react';

interface Props {
  title: string;
  onClose: () => void;
  /** Un envoi est en cours : Échap est sans effet (fermer perdrait le résultat, audit R-22). */
  busy?: boolean;
  children: React.ReactNode;
}

/**
 * Fenêtre modale (alignée à gauche même ouverte depuis une cellule alignée à droite) : voile, titre serif, Échap pour fermer, focus rendu à la fermeture. Le voile ne ferme pas la fenêtre.
 * Pendant un envoi (`busy`), Échap ne la ferme pas non plus, comme le tiroir des accès.
 */
export function DialogFrame({ title, onClose, busy = false, children }: Props) {
  const titleId = useId();
  const frameRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    frameRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) closeRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-[rgba(20,50,42,0.35)] px-7 py-9">
      <div
        ref={frameRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-[440px] rounded-xl bg-surface p-[22px] text-left text-fg shadow-lg outline-none"
      >
        <h4 id={titleId} className="mb-1.5 font-serif text-[19px] font-normal">{title}</h4>
        {children}
      </div>
    </div>
  );
}
