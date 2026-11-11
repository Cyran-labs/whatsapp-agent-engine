'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const NAV_SELECTOR = '[data-menu-nav]';

function navItems(menu: HTMLElement | null): HTMLElement[] {
  return menu ? Array.from(menu.querySelectorAll<HTMLElement>(NAV_SELECTOR)) : [];
}

/**
 * Comportement commun des menus du bandeau : fermeture par Échap (focus rendu au
 * déclencheur), clic extérieur ou sortie du focus ; flèches haut/bas, Début et Fin
 * entre les éléments marqués `data-menu-nav` ; focus sur le premier à l'ouverture. Le menu peut être rendu hors de la
 * racine (portail) : il compte comme à l'intérieur pour le clic extérieur et la sortie du focus.
 */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const show = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((o) => !o), []);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current && !rootRef.current.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) navItems(menuRef.current)[0]?.focus();
  }, [open]);

  const onMenuKeyDown = useCallback((e: React.KeyboardEvent) => {
    const items = navItems(menuRef.current);
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % items.length;
    else if (e.key === 'ArrowUp') next = index <= 0 ? items.length - 1 : index - 1;
    else if (e.key === 'Home' || e.key === 'End') {
      // Dans un champ de saisie, Début et Fin déplacent le curseur de texte.
      if (e.target instanceof HTMLInputElement) return;
      next = e.key === 'Home' ? 0 : items.length - 1;
    }
    if (next === null) return;
    e.preventDefault();
    items[next].focus();
  }, []);

  const onRootBlur = useCallback((e: React.FocusEvent) => {
    const to = e.relatedTarget as Node | null;
    if (to && rootRef.current && !rootRef.current.contains(to) && !menuRef.current?.contains(to)) setOpen(false);
  }, []);

  return { open, show, close, toggle, rootRef, triggerRef, menuRef, onMenuKeyDown, onRootBlur };
}
