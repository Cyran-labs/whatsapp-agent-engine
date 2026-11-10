'use client';

import { useEffect, useId, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { usePopover } from '@/components/shell/use-popover';
import { Button } from '@/components/ui/button';
import { placeMenu } from './place-menu';

interface ActionMenuItemBase {
  key: string;
  label: string;
  onSelect: () => void;
  danger?: boolean;
  /** Lien externe : l'élément est un `<a>` qui s'ouvre dans un nouvel onglet (`onSelect` n'est pas appelé). */
  href?: string;
}

/**
 * Élément d'un menu d'actions, successeur de l'ancien `MenuItem` des tableaux (supprimé). Un élément désactivé dit
 * toujours pourquoi : `disabledReason` est obligatoire avec `disabled: true` (aucun élément d'interface sans effet
 * qui ne le dit pas).
 */
export type ActionMenuItem = ActionMenuItemBase &
  (
    | { disabled?: false; disabledReason?: undefined }
    /** Raison visible sous l'élément, qui le décrit (`aria-describedby`). */
    | { disabled: true; disabledReason: string }
  );

interface Props {
  /** Texte du bouton, « Gérer » par défaut (choix C-3 A). */
  label?: string;
  /** Objet géré (« Boutique principale ») : nommé dans le nom accessible du bouton et du menu, « Gérer (Boutique principale) ». */
  subject?: string;
  items: ActionMenuItem[];
}

const ITEM = 'block w-full rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-surface-subtle focus-visible:bg-surface-subtle focus-visible:outline-none';

/**
 * Menu d'actions d'une ligne : bouton contour libellé « Gérer ▾ » à la place du « ⋯ » invisible (recette Q-6, Q-7).
 * Clavier et fermeture de `usePopover` : focus sur le premier élément à l'ouverture, flèches, Début et Fin, Échap ferme
 * et rend le focus au bouton, clic extérieur ou sortie du focus ferment. Un élément désactivé reste une étape des
 * flèches (`aria-disabled`, motif des menus WAI-ARIA) : le focus y lit sa raison ; le choisir ne fait rien. Le bouton garde `aria-haspopup="menu"` : `useReturnFocus` y rend le focus après une fenêtre.
 */
export function ActionMenu({ label, subject, items }: Props) {
  const t = useTranslations('actions');
  const { open, close, toggle, rootRef, triggerRef, menuRef, onMenuKeyDown, onRootBlur } = usePopover();
  const baseId = useId();
  const text = label ?? t('manage');
  const name = subject ? t('named', { label: text, subject }) : text;

  // Menu rendu dans `document.body` en position fixe : aucun conteneur (carte `overflow-hidden`, zone de défilement)
  // ne le rogne. Placé avant la peinture ; ouvert vers le haut quand la place manque en bas.
  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!open || !trigger || !menu) return;
    const { height, width } = menu.getBoundingClientRect();
    const { top, left } = placeMenu({
      trigger: trigger.getBoundingClientRect(),
      menu: { width: width || menu.offsetWidth, height: height || menu.offsetHeight },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
  }, [open, triggerRef, menuRef]);

  // Position fixe : un défilement de la page ou un redimensionnement détacherait le menu de son bouton, il se ferme.
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && menuRef.current?.contains(e.target)) return;
      close();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open, close, menuRef]);

  return (
    <div ref={rootRef} className="relative inline-block" onBlur={onRootBlur}>
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={subject ? name : undefined}
        onClick={toggle}
        className={`h-auto gap-1 border-border-strong px-2.5 py-[5px] text-[12.5px] font-semibold ${open ? 'bg-surface-subtle' : ''}`}
      >
        {text}
        <span aria-hidden="true" className="text-[10px] text-muted">▾</span>
      </Button>
      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={name}
          onKeyDown={onMenuKeyDown}
          className="fixed z-30 w-[230px] rounded-lg border border-border bg-surface p-[5px] text-left shadow-lg"
        >
          {items.map((item) => {
            if (item.href) {
              return (
                <a
                  key={item.key}
                  role="menuitem"
                  data-menu-nav
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={close}
                  className={ITEM}
                >
                  {item.label}
                </a>
              );
            }
            const reasonId = item.disabled ? `${baseId}-${item.key}-reason` : undefined;
            return (
              <div key={item.key} role="none">
                <button
                  type="button"
                  role="menuitem"
                  data-menu-nav
                  aria-disabled={item.disabled ? true : undefined}
                  aria-describedby={reasonId}
                  onClick={() => {
                    if (item.disabled) return;
                    close();
                    item.onSelect();
                  }}
                  className={`${ITEM} aria-disabled:cursor-default aria-disabled:text-muted-2 aria-disabled:hover:bg-transparent ${item.danger ? 'text-danger' : ''}`}
                >
                  {item.label}
                </button>
                {reasonId && (
                  <p id={reasonId} className="px-2.5 pb-1.5 text-[11.5px] leading-snug text-muted">
                    {item.disabledReason}
                  </p>
                )}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
