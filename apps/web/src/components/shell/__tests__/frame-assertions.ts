import { screen, within } from '@testing-library/react';
import { expect } from 'vitest';
import type { Space } from '../app-rail';

/**
 * Constats communs aux tests de pages connectées (spec 5, 10, 11) : entrée active du rail, bloc Organisation en tête
 * de la colonne du milieu, en-tête de page (parents, titre, actions, bouton rond) ; fil d'Ariane et action principale
 * de l'ancienne barre du haut tant que des pages la gardent (`trail`, `pageBar`, retirés avec elle).
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

/** L'en-tête de page (`[data-page-header]`), unique. */
function pageHeader(): HTMLElement {
  const headers = document.querySelectorAll<HTMLElement>('[data-page-header]');
  expect(headers).toHaveLength(1);
  return headers[0] as HTMLElement;
}

/** Nom accessible d'un lien ou d'un bouton de l'en-tête : `aria-label`, sinon son texte. */
function controlName(el: Element): string {
  return (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Libellés des liens de la ligne des parents, dans l'ordre ; vide quand la page n'a pas de ligne des parents. */
export function headerParents(): string[] {
  const nav = within(pageHeader()).queryByRole('navigation', { name: "Fil d'Ariane" });
  return nav ? within(nav).queryAllByRole('link').map((a) => a.textContent ?? '') : [];
}

/** Le titre de la page : seul `h1` de la page, dans l'en-tête. */
export function headerTitle(): HTMLElement {
  const headings = screen.getAllByRole('heading', { level: 1 });
  expect(headings).toHaveLength(1);
  const title = headings[0] as HTMLElement;
  expect(pageHeader()).toContainElement(title);
  return title;
}

/** Noms accessibles des liens et boutons de la zone `data-page-action` (actions, puis bouton rond), dans l'ordre. */
export function headerActions(): string[] {
  const zone = pageHeader().querySelector('[data-page-action]');
  return zone ? Array.from(zone.querySelectorAll('a, button')).map(controlName) : [];
}

/**
 * Bouton rond de création : `null`, la page n'en a pas ; sinon il est dans la zone des actions, porte ce nom, et aucune
 * autre commande de la page n'a ce nom (une action n'apparaît jamais deux fois, spec 7.5).
 */
export function expectCreateButton(name: string | null): HTMLElement | null {
  const rounds = Array.from(document.querySelectorAll<HTMLElement>('[data-page-create]'));
  if (name === null) {
    expect(rounds).toEqual([]);
    return null;
  }
  expect(rounds).toHaveLength(1);
  const round = rounds[0] as HTMLElement;
  expect(pageHeader().querySelector('[data-page-action]')).toContainElement(round);
  expect(controlName(round)).toBe(name);
  const same = Array.from(document.querySelectorAll('a, button')).filter((el) => controlName(el) === name);
  expect(same).toEqual([round]);
  return round;
}
