import { expect, test } from 'vitest';
import { placeMenu } from '../place-menu';

const viewport = { width: 1000, height: 600 };
const menu = { width: 230, height: 160 };

// recette 10 nov. 2026 (menu « Gérer » coupé en bas de tableau)
test('place suffisante en dessous : ouvert vers le bas, aligné à droite du bouton', () => {
  const p = placeMenu({ trigger: { top: 100, bottom: 130, right: 900 }, menu, viewport });
  expect(p).toEqual({ direction: 'down', top: 134, left: 670 });
});

test('place manquante en dessous et plus de place au-dessus : ouvert vers le haut', () => {
  const p = placeMenu({ trigger: { top: 540, bottom: 570, right: 900 }, menu, viewport });
  expect(p.direction).toBe('up');
  expect(p.top).toBe(540 - 4 - 160);
});

test('ni en bas ni en haut assez de place : le côté le plus large est choisi', () => {
  const p = placeMenu({ trigger: { top: 100, bottom: 130, right: 900 }, menu: { width: 230, height: 900 }, viewport: { width: 1000, height: 300 } });
  expect(p.direction).toBe('down');
});

test('le menu ne sort jamais de la fenêtre à gauche ni à droite', () => {
  expect(placeMenu({ trigger: { top: 10, bottom: 40, right: 100 }, menu, viewport }).left).toBe(8);
  expect(placeMenu({ trigger: { top: 10, bottom: 40, right: 1200 }, menu, viewport }).left).toBe(1000 - 230 - 8);
});

test('vers le haut, le menu ne dépasse pas le bord supérieur', () => {
  const p = placeMenu({ trigger: { top: 100, bottom: 130, right: 900 }, menu: { width: 230, height: 400 }, viewport: { width: 1000, height: 200 } });
  expect(p.top).toBeGreaterThanOrEqual(8);
});
