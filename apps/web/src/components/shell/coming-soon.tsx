'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/** `below-end` : dessous, alignée sur le bord droit de l'élément (bouton rond en haut à droite d'une page). */
export type HintPlacement = 'right' | 'below' | 'below-end';

/**
 * Bulle d'explication reliée à son déclencheur par `aria-describedby` : visible au survol et au focus,
 * masquée en le quittant, par Échap, par un défilement ou un redimensionnement. Partagée par les éléments à venir et les mentions qui ont
 * un motif. `anchorRef` est posé sur le déclencheur (dans `triggerProps`) : la bulle se place d'après lui.
 */
export function useHint<T extends HTMLElement = HTMLDivElement>() {
  const id = useId();
  const anchorRef = useRef<T>(null);
  const [open, setOpen] = useState(false);
  const show = () => setOpen(true);
  const hide = () => setOpen(false);
  // La bulle est en position fixe : un défilement (colonne ou page) ou un redimensionnement de la fenêtre
  // l'éloignerait de son élément, elle se ferme.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
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
  'below-end': 'max-w-[240px]',
};

/**
 * Position de la bulle dans la fenêtre, d'après son élément : à droite, centrée en hauteur ; dessous, ou au-dessus
 * quand la fenêtre n'a pas la place dessous, alignée sur le bord gauche de l'élément (`below`) ou sur son bord droit
 * (`below-end`).
 */
function bubblePosition(anchor: DOMRect, size: { width: number; height: number }, placement: HintPlacement): { top: number; left: number } {
  const { width, height } = size;
  if (placement === 'right') return { top: anchor.top + anchor.height / 2 - height / 2, left: anchor.right + 8 };
  const below = anchor.bottom + 4;
  const above = anchor.top - 4 - height;
  const top = below + height > window.innerHeight && above >= 0 ? above : below;
  return { top, left: placement === 'below-end' ? Math.max(0, anchor.right - width) : anchor.left };
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
    const bubble = bubbleRef.current;
    setPosition(bubblePosition(anchor.current.getBoundingClientRect(), { width: bubble?.offsetWidth ?? 0, height: bubble?.offsetHeight ?? 0 }, placement));
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
  role = 'link',
  label,
  className,
  children,
}: {
  tooltip: string;
  badge?: boolean;
  placement?: HintPlacement;
  /**
   * `link` pour une entrée de navigation (rail, colonne du milieu) ; `group` pour un bloc à venir dans une page
   * (section CRM, carte d'un mode), nommé par `label` (spec 5.4).
   */
  role?: 'link' | 'group';
  /** Nom accessible d'un `group` (un groupe ne prend pas son nom de son contenu). */
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  const hint = useHint();
  return (
    <div className="relative">
      <div role={role} aria-label={label} aria-disabled="true" tabIndex={0} {...hint.triggerProps} className={cn('cursor-not-allowed', className)}>
        {children}
        {badge && <SoonBadge className="ml-auto" />}
      </div>
      <HintBubble id={hint.id} open={hint.open} text={tooltip} anchor={hint.anchorRef} placement={placement} />
    </div>
  );
}
