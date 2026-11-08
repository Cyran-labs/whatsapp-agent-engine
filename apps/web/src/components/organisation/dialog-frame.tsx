'use client';

import { useEffect, useId, useRef } from 'react';

/** Fenêtre modale : voile, titre serif, Échap pour fermer, focus rendu à la fermeture. */
export function DialogFrame({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const titleId = useId();
  const frameRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    frameRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
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
        className="w-full max-w-[440px] rounded-xl bg-surface p-[22px] text-fg shadow-lg outline-none"
      >
        <h4 id={titleId} className="mb-1.5 font-serif text-[19px] font-normal">{title}</h4>
        {children}
      </div>
    </div>
  );
}
