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
    // les segments point sont résolus par le navigateur : le contrôle porte sur le chemin normalisé
    ['segment .. vers l\'API', '/fr/../api/x'],
    ['segment %2e%2e vers l\'API', '/%2e%2e/api/x'],
    ['segment %2E%2E majuscule', '/%2E%2E/api/auth/me'],
    ['segment . vers l\'API', '/./api/x'],
    ['.. vers l\'API avec requête', '/fr/../api/auth/me?x=1'],
    ['.. qui redonne //hôte', '/fr/..//evil.example'],
    ['.. au delà de la racine puis API', '/../../api/x'],
    // une adresse forgée ne ramène pas un utilisateur connecté sur une page publique d'authentification
    ['connexion', '/fr/login'],
    ['connexion avec barre finale', '/fr/login/'],
    ['connexion avec requête', '/en/login?next=/fr/agents'],
    ['connexion sans langue', '/login'],
    ['connexion par segment ..', '/fr/agents/../login'],
    ['mot de passe oublié', '/fr/forgot-password'],
    ['réinitialisation', '/en/reset-password?token=t'],
    ['page d\'invitation', '/fr/accept-invite?token=t'],
    // Next décode les segments avant d'acheminer : /fr/%6Cogin est servi comme la connexion
    ['connexion, lettre encodée', '/fr/%6Cogin'],
    ['connexion, lettre encodée au milieu', '/fr/log%69n'],
    ['mot de passe oublié, tiret encodé', '/fr/forgot%2Dpassword'],
    ['connexion, langue encodée', '/%66r/login'],
    ['connexion, tout encodé en majuscules', '/%66%72/%6C%6F%67%69%6E'],
    ['séparateur encodé dans un segment', '/fr/agents%2F..%2Flogin'],
    ['barre oblique inverse encodée', '/fr/%5Clogin'],
    ['encodage malformé', '/fr/%E0%A4%A'],
  ])('%s : refusé', (_label, raw) => {
    expect(safeNext(raw)).toBeNull();
  });

  test('chemin normalisé retourné, segments point résolus', () => {
    expect(safeNext('/fr/agents/../organisation/membres?x=1#h')).toBe('/fr/organisation/membres?x=1#h');
    expect(safeNext('/fr/./agents')).toBe('/fr/agents');
  });

  test('chemins proches des pages publiques mais bien internes : acceptés', () => {
    expect(safeNext('/fr/agents/login')).toBe('/fr/agents/login');
    expect(safeNext('/fr/loginx')).toBe('/fr/loginx');
    expect(safeNext('/fr/organisation/accept-invite')).toBe('/fr/organisation/accept-invite');
    // spec 10.6 : /forbidden n'est plus une page publique (supprimée)
    expect(safeNext('/fr/forbidden')).toBe('/fr/forbidden');
  });

  test('segment accentué encodé : accepté et rendu tel quel', () => {
    expect(safeNext('/fr/agents/caf%C3%A9')).toBe('/fr/agents/caf%C3%A9');
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
    expect(loginPathFor('/fr/login/')).toBe('/login?reason=session');
  });

  test('chemin non sûr : aucun retour demandé', () => {
    expect(loginPathFor('//evil.example')).toBe('/login?reason=session');
  });
});
