import { describe, expect, test } from 'vitest';
import { loginPathFor, safeNext, splitLocale } from '../safe-next';

describe('safeNext', () => {
  test('chemin interne avec locale et requête : conservé tel quel', () => {
    expect(safeNext('/fr/organisation/membres')).toBe('/fr/organisation/membres');
    expect(safeNext('/fr/agents/12?tab=numero#haut')).toBe('/fr/agents/12?tab=numero#haut');
    expect(safeNext('/')).toBe('/');
  });

  // audit R-10 : point d'attention 1, une adresse hostile ne mène jamais hors du site
  test.each([
    ['URL absolue', 'https://evil.example/fr'],
    ['schéma sans barres', 'javascript:alert(1)'],
    ['adresse relative au protocole', '//evil.example'],
    ['barre oblique inverse', '/\\evil.example'],
    ['barres mêlées', '\\/evil.example'],
    ['tabulation avalée par le navigateur', '/\t/evil.example'],
    ['saut de ligne', '/\n/evil.example'],
    ['sans barre initiale', 'fr/agents'],
    ['route d\'API', '/api/auth/logout'],
    ['route d\'API nue', '/api'],
    ['vide', ''],
    ['espace initial', ' /fr'],
  ])('%s : refusé', (_label, raw) => {
    expect(safeNext(raw)).toBeNull();
  });

  test('absent : null', () => {
    expect(safeNext(null)).toBeNull();
  });
});

describe('splitLocale', () => {
  const locales = ['fr', 'en'] as const;

  test('préfixe de langue séparé du reste, requête conservée', () => {
    expect(splitLocale('/fr/organisation/membres?x=1', locales)).toEqual({ locale: 'fr', path: '/organisation/membres?x=1' });
    expect(splitLocale('/en', locales)).toEqual({ locale: 'en', path: '/' });
    expect(splitLocale('/en?welcome=1', locales)).toEqual({ locale: 'en', path: '/?welcome=1' });
  });

  test('sans langue reconnue : chemin inchangé', () => {
    expect(splitLocale('/frites', locales)).toEqual({ locale: null, path: '/frites' });
    expect(splitLocale('/de/agents', locales)).toEqual({ locale: null, path: '/de/agents' });
  });
});

describe('loginPathFor', () => {
  test('raison de session et chemin actuel encodé', () => {
    expect(loginPathFor('/fr/organisation/membres?x=1&y=2')).toBe(
      '/login?reason=session&next=%2Ffr%2Forganisation%2Fmembres%3Fx%3D1%26y%3D2',
    );
  });

  test('chemin déjà sur la connexion : pas de boucle, aucun retour demandé', () => {
    expect(loginPathFor('/fr/login?reason=session')).toBe('/login?reason=session');
  });

  test('chemin non sûr : aucun retour demandé', () => {
    expect(loginPathFor('//evil.example')).toBe('/login?reason=session');
  });
});
