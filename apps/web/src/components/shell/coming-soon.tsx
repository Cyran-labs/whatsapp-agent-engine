'use client';

import { useId, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

export type HintPlacement = 'right' | 'below';

/**
 * Bulle d'explication reliée à son déclencheur par `aria-describedby` : visible au survol et au focus,
 * masquée en le quittant ou par Échap. Partagée par les éléments à venir et les mentions qui ont un motif.
 */
export function useHint() {
  const id = useId();
  const [open, setOpen] = useState(false);
  const show = () => setOpen(true);
  const hide = () => setOpen(false);
  return {
    id,
    open,
    triggerProps: {
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

const PLACEMENT: Record<HintPlacement, string> = {
  // À droite : hors du rail, au-dessus de la colonne du milieu.
  right: 'left-[calc(100%+8px)] top-1/2 -translate-y-1/2 max-w-[240px]',
  // Dessous : tient dans la largeur d'une entrée de la colonne du milieu (236 px moins ses marges).
  below: 'left-0 top-[calc(100%+4px)] max-w-[208px]',
};

export function HintBubble({ id, open, text, placement = 'below' }: { id: string; open: boolean; text: string; placement?: HintPlacement }) {
  return (
    <span
      id={id}
      role="tooltip"
      hidden={!open}
      className={cn(
        'pointer-events-none absolute z-50 w-max rounded-md bg-fg px-2 py-1.5 text-left text-[11.5px] font-normal normal-case leading-snug tracking-normal text-bg shadow-md',
        PLACEMENT[placement],
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
 * Élément à venir : grisé par l'appelant, jamais un lien, `aria-disabled`, focalisable au clavier pour lire sa bulle
 * (« Disponible prochainement : … »). `badge` ajoute la pastille « Soon » à droite.
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
    <div aria-disabled="true" tabIndex={0} {...hint.triggerProps} className={cn('relative cursor-not-allowed', className)}>
      {children}
      {badge && <SoonBadge className="ml-auto" />}
      <HintBubble id={hint.id} open={hint.open} text={tooltip} placement={placement} />
    </div>
  );
}
