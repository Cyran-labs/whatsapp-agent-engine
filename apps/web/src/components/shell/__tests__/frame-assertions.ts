import { screen, within } from '@testing-library/react';
import { expect } from 'vitest';
import type { Space } from '../app-rail';

/**
 * Constats communs aux tests de pages connectées (spec 5, 10, 11) : entrée active du rail, bloc Organisation en tête
 * de la colonne du milieu, fil d'Ariane et action principale dans la barre du haut.
 */

/** Seule l'entrée `space` du rail porte `aria-current="page"` ; `null` : aucune entrée active. */
export function expectRailActive(space: Space | null): void {
  const rail = screen.getByRole('navigation', { name: 'Navigation principale' });
  const current = Array.from(rail.querySelectorAll('[aria-current="page"]')).map((el) => el.getAttribute('data-rail-entry'));
  expect(current).toEqual(space === null ? [] : [space]);
}

/** Colonne du milieu : le bloc Organisation en est le premier enfant et nomme l'organisation active. */
export function expectOrgBlockFirst(orgName: string): void {
  const column = screen.getByRole('complementary');
  const first = column.firstElementChild as HTMLElement;
  expect(first).toHaveAttribute('data-org-block');
  expect(first).toHaveTextContent('Organisation');
  expect(first).toHaveTextContent(orgName);
}

/** Pages du compte : aucun bloc Organisation dans la colonne. */
export function expectNoOrgBlock(): void {
  expect(screen.getByRole('complementary').querySelector('[data-org-block]')).toBeNull();
}

/** Segments du fil d'Ariane, dans l'ordre (séparateurs exclus). */
export function trail(): string[] {
  const nav = screen.getByRole('navigation', { name: "Fil d'Ariane" });
  return within(nav).getAllByRole('listitem').map((li) => li.textContent ?? '');
}

/** La barre du haut : le parent du fil d'Ariane. */
export function pageBar(): HTMLElement {
  return screen.getByRole('navigation', { name: "Fil d'Ariane" }).parentElement as HTMLElement;
}

/** L'action principale est dans la barre du haut, et nulle part ailleurs dans la page. */
export function expectActionInBar(role: 'button' | 'link', name: string | RegExp): HTMLElement {
  const inBar = within(pageBar()).getByRole(role, { name });
  expect(screen.getAllByRole(role, { name })).toEqual([inBar]);
  return inBar;
}

/** La barre du haut n'a aucune action à droite du fil. */
export function expectNoBarAction(): void {
  const bar = pageBar();
  expect(within(bar).queryAllByRole('button')).toEqual([]);
  const links = within(bar).queryAllByRole('link');
  const nav = within(bar).getByRole('navigation', { name: "Fil d'Ariane" });
  expect(links.every((link) => nav.contains(link))).toBe(true);
}
