'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export type HintPlacement = 'right' | 'below';

/**
 * Bulle d'explication reliée à son déclencheur par `aria-describedby` : visible au survol et au focus,
 * masquée en le quittant, par Échap ou par un défilement. Partagée par les éléments à venir et les mentions qui ont
 * un motif. `anchorRef` est posé sur le déclencheur (dans `triggerProps`) : la bulle se place d'après lui.
 */
export function useHint<T extends HTMLElement = HTMLDivElement>() {
  const id = useId();
  const anchorRef = useRef<T>(null);
  const [open, setOpen] = useState(false);
  const show = () => setOpen(true);
  const hide = () => setOpen(false);
  // La bulle est en position fixe : un défilement (colonne ou page) l'éloignerait de son élément, elle se ferme.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    return () => window.removeEventListener('scroll', close, true);
  }, [open]);
  return {
    id,
    open,
    anchorRef,
    triggerProps: {
      ref: anchorRef,
      'aria-describedby': id,
      onMouseEnter: show,
      onMouseLeave: hide,
      onFocus: show,
      onBlur: hide,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') hide();
      },
    },
  };
}

const MAX_WIDTH: Record<HintPlacement, string> = {
  // À droite : hors du rail, au-dessus de la colonne du milieu.
  right: 'max-w-[240px]',
  // Dessous : tient dans la largeur d'une entrée de la colonne du milieu (236 px moins ses marges).
  below: 'max-w-[208px]',
};

/**
 * Position de la bulle dans la fenêtre, d'après son élément : à droite, centrée en hauteur ; dessous, ou au-dessus
 * quand la fenêtre n'a pas la place dessous.
 */
function bubblePosition(anchor: DOMRect, height: number, placement: HintPlacement): { top: number; left: number } {
  if (placement === 'right') return { top: anchor.top + anchor.height / 2 - height / 2, left: anchor.right + 8 };
  const below = anchor.bottom + 4;
  const above = anchor.top - 4 - height;
  return { top: below + height > window.innerHeight && above >= 0 ? above : below, left: anchor.left };
}

/**
 * Bulle en position fixe (relecture tâche 5, M-6) : hors du flux de la colonne du milieu, qui défile, elle n'y est
 * jamais coupée. Invisible tant que sa position n'est pas calculée.
 */
export function HintBubble({
  id,
  open,
  text,
  anchor,
  placement = 'below',
}: {
  id: string;
  open: boolean;
  text: string;
  anchor: RefObject<HTMLElement | null>;
  placement?: HintPlacement;
}) {
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !anchor.current) {
      setPosition(null);
      return;
    }
    setPosition(bubblePosition(anchor.current.getBoundingClientRect(), bubbleRef.current?.offsetHeight ?? 0, placement));
  }, [open, anchor, placement]);
  return (
    <span
      ref={bubbleRef}
      id={id}
      role="tooltip"
      hidden={!open}
      style={position ? { top: position.top, left: position.left } : { visibility: 'hidden' }}
      className={cn(
        'pointer-events-none fixed z-50 w-max rounded-md bg-fg px-2 py-1.5 text-left text-[11.5px] font-normal normal-case leading-snug tracking-normal text-bg shadow-md',
        MAX_WIDTH[placement],
      )}
    >
      {text}
    </span>
  );
}

const BADGE = 'shrink-0 whitespace-nowrap rounded-pill px-[7px] text-[10px] font-semibold leading-4 tracking-[0.3px]';

/** Pastille « Soon » (spec 5.2), en anglais dans les deux langues (spec 6.3). */
export function SoonBadge({ className }: { className?: string }) {
  const t = useTranslations('common');
  return <span className={cn(BADGE, 'border border-border text-muted-2', className)}>{t('soon')}</span>;
}

/** Pastille « New » (spec 5.2) : prise en charge, portée par aucune entrée dans ce lot. */
export function NewBadge({ className }: { className?: string }) {
  const t = useTranslations('common');
  return <span className={cn(BADGE, 'bg-success-soft text-success-ink', className)}>{t('new')}</span>;
}

/**
 * Élément à venir : grisé par l'appelant (sur son contenu, jamais sur la racine), jamais un lien réel : `role="link"`
 * sans `href` et `aria-disabled="true"`, pour être annoncé indisponible ; focalisable au clavier pour lire sa bulle
 * (« Disponible prochainement : … »). La bulle est hors de l'élément : elle n'entre pas dans son nom et garde son
 * contraste plein. `badge` ajoute la pastille « Soon » à droite.
 */
export function ComingSoon({
  tooltip,
  badge = false,
  placement = 'below',
  className,
  children,
}: {
  tooltip: string;
  badge?: boolean;
  placement?: HintPlacement;
  className?: string;
  children: ReactNode;
}) {
  const hint = useHint();
  return (
    <div className="relative">
      <div role="link" aria-disabled="true" tabIndex={0} {...hint.triggerProps} className={cn('cursor-not-allowed', className)}>
        {children}
        {badge && <SoonBadge className="ml-auto" />}
      </div>
      <HintBubble id={hint.id} open={hint.open} text={tooltip} anchor={hint.anchorRef} placement={placement} />
    </div>
  );
}
