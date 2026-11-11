import { test, expect } from '@playwright/test';
import { failRoute, login, loginToAgents, orgSwitcher, rail, resetMock } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test('login échoue avec un mauvais mot de passe', async ({ page }) => {
  await login(page, 'demo@wabagent.test', 'mauvais-mdp1');
  const alert = page.getByRole('alert').filter({ hasText: 'Identifiants invalides.' });
  await expect(alert).toBeVisible();
});

// audit R-1 : moteur arrêté (le BFF répond 500), la connexion le dit au lieu d'accuser le mot de passe
test('moteur en panne : texte de panne, jamais « Identifiants invalides. »', async ({ page, request }) => {
  await failRoute(request, '/auth/login', 500, { requestId: 'req-auth-login' });
  await login(page, 'demo@wabagent.test');
  const alert = page.getByRole('alert').filter({ hasText: 'Connexion impossible pour le moment. Réessayez dans un instant.' });
  await expect(alert).toBeVisible();
  // restitution : la référence de la requête suit le texte de panne
  await expect(alert).toContainText('Référence : req-auth-login');
  await expect(page.getByText('Identifiants invalides.')).toHaveCount(0);
  await expect(page).toHaveURL(/\/fr\/login$/);
  await expect(page.getByRole('button', { name: 'Se connecter' })).toBeEnabled();
});

// audit R-10 : session perdue sur une page de l'application
test('session expirée : connexion expliquée, puis retour sur la page où l\'on était', async ({ page, context }) => {
  // session perdue en cours d'utilisation : jeton d'accès refusé et plus de jeton de renouvellement
  await loginToAgents(page, 'demo@wabagent.test');
  await page.goto('/fr/organisation/entites?tab=archivees');
  await expect(page.getByRole('heading', { name: 'Entités' })).toBeVisible();

  await context.clearCookies({ name: 'wab_refresh' });
  await context.addCookies([{ name: 'wab_access', value: 'jeton-perime', url: 'http://localhost:3002' }]);
  await page.reload();

  await expect(page).toHaveURL(/\/fr\/login\?reason=session&next=%2Ffr%2Forganisation%2Fentites%3Ftab%3Darchivees$/);
  await expect(page.getByRole('status')).toHaveText(
    "Votre session a expiré. Reconnectez-vous pour reprendre là où vous étiez. Ce qui n'était pas enregistré est perdu.",
  );

  await page.getByLabel('Adresse e-mail').fill('demo@wabagent.test');
  await page.getByLabel('Mot de passe').fill('motdepasse12');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/fr\/organisation\/entites\?tab=archivees$/);
  await expect(page.getByRole('heading', { name: 'Entités' })).toBeVisible();
});

// audit R-10 : page profonde ouverte sans session, pas de phrase « session expirée » (on ne sait pas si une session existait)
test('page profonde sans session : connexion sans bandeau, puis arrivée sur cette page', async ({ page }) => {
  await page.goto('/fr/organisation/entites?tab=archivees');
  await expect(page).toHaveURL(/\/fr\/login\?next=%2Ffr%2Forganisation%2Fentites%3Ftab%3Darchivees$/);
  await expect(page.getByRole('status')).toHaveCount(0);

  await page.getByLabel('Adresse e-mail').fill('demo@wabagent.test');
  await page.getByLabel('Mot de passe').fill('motdepasse12');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/fr\/organisation\/entites\?tab=archivees$/);
  await expect(page.getByRole('heading', { name: 'Entités' })).toBeVisible();
});

// audit R-10 : point d'attention 1, un retour hostile mène à l'accueil
test('retour hostile (?next=//…) : la connexion mène à l\'accueil', async ({ page }) => {
  await page.goto('/fr/login?reason=session&next=%2F%2Fevil.example%2Fpiege');
  await page.getByLabel('Adresse e-mail').fill('demo@wabagent.test');
  await page.getByLabel('Mot de passe').fill('motdepasse12');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { name: 'Agents IA', exact: true })).toBeVisible();
  expect(new URL(page.url()).hostname).toBe('localhost');
});

test('route protégée sans session : redirige vers login', async ({ page }) => {
  await page.goto('/fr');
  await expect(page).toHaveURL(/\/fr\/login$/);
});

test('connexion multi-organisation puis bascule vers Atelier Nord', async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');

  // Maison Lumière : admin, donc l'entrée Organisation et la création d'un agent IA sont là
  await expect(page.getByText('Support technique')).toBeVisible();
  await expect(rail(page).getByRole('link', { name: 'Organisation' })).toBeVisible();
  await expect(page.getByRole('link', { name: '+ Créer un agent IA' })).toBeVisible();

  await expect(orgSwitcher(page)).toContainText('Maison Lumière');
  await orgSwitcher(page).click();
  await page.getByRole('button', { name: /Atelier Nord/ }).click();

  // Atelier Nord : conseiller, la liste change et l'entrée Organisation disparaît
  await expect(page.getByText('Assistant atelier')).toBeVisible();
  await expect(page.getByText('Support technique')).toHaveCount(0);
  await expect(orgSwitcher(page)).toContainText('Atelier Nord');
  await expect(rail(page).getByRole('link', { name: 'Organisation' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '+ Créer un agent IA' })).toHaveCount(0);

  // l'organisation choisie est mémorisée (cookie) après rechargement
  await page.reload();
  await expect(page.getByText('Assistant atelier')).toBeVisible();
});

test('conseiller mono-organisation : ni sélecteur, ni Organisation, ni création', async ({ page }) => {
  await loginToAgents(page, 'advisor@wabagent.test');

  await expect(page.getByText('Support technique')).toBeVisible();
  await expect(rail(page).getByRole('link', { name: 'Organisation' })).toHaveCount(0);
  // une seule organisation : le bloc Organisation la nomme, sans sélecteur
  await expect(page.locator('[data-org-block]')).toContainText('Maison Lumière');
  await expect(orgSwitcher(page)).toHaveCount(0);
  await expect(page.getByRole('link', { name: '+ Créer un agent IA' })).toHaveCount(0);

  // l'accès direct à l'espace Organisation ramène à la liste des agents IA
  await page.goto('/fr/organisation/entites');
  await expect(page).not.toHaveURL(/organisation/);
  await expect(page.getByRole('heading', { name: 'Agents IA', exact: true })).toBeVisible();
});

test('organisation active : reprise par le même compte, ignorée si le cookie vient d\'un autre compte', async ({ page, context }) => {
  // cookie wab_org posé par un autre utilisateur du navigateur (id 2) : Maison Lumière, la première
  await context.addCookies([{ name: 'wab_org', value: '2:c2', url: 'http://localhost:3002' }]);
  await loginToAgents(page, 'demo@wabagent.test');
  await expect(page.getByText('Support technique')).toBeVisible();

  // ancien format nu : traité comme absent
  await context.clearCookies();
  await context.addCookies([{ name: 'wab_org', value: 'c2', url: 'http://localhost:3002' }]);
  await loginToAgents(page, 'demo@wabagent.test');
  await expect(page.getByText('Support technique')).toBeVisible();

  // posé par ce compte (id 1) : Atelier Nord reprise
  await context.clearCookies();
  await context.addCookies([{ name: 'wab_org', value: '1:c2', url: 'http://localhost:3002' }]);
  await login(page, 'demo@wabagent.test');
  await expect(page.getByText('Assistant atelier')).toBeVisible();
  await expect(orgSwitcher(page)).toContainText('Atelier Nord');
});
