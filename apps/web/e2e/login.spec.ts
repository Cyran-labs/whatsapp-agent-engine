import { test, expect } from '@playwright/test';
import { login, loginToAgents, resetMock } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test('login échoue avec un mauvais mot de passe', async ({ page }) => {
  await login(page, 'demo@wabagent.test', 'mauvais-mdp1');
  const alert = page.getByRole('alert').filter({ hasText: 'Identifiants invalides.' });
  await expect(alert).toBeVisible();
});

test('route protégée sans session : redirige vers login', async ({ page }) => {
  await page.goto('/fr');
  await expect(page).toHaveURL(/\/fr\/login$/);
});

test('connexion multi-organisation puis bascule vers Atelier Nord', async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');

  const topBar = page.getByRole('banner');
  // Maison Lumière : admin, donc l'entrée Organisation et la création d'un agent IA sont là
  await expect(page.getByText('Support technique')).toBeVisible();
  await expect(topBar.getByRole('link', { name: 'Organisation' })).toBeVisible();
  await expect(page.getByRole('link', { name: '+ Créer un agent IA' })).toBeVisible();

  await topBar.getByRole('button', { name: /Maison Lumière/ }).click();
  await page.getByRole('button', { name: /Atelier Nord/ }).click();

  // Atelier Nord : conseiller, la liste change et l'entrée Organisation disparaît
  await expect(page.getByText('Assistant atelier')).toBeVisible();
  await expect(page.getByText('Support technique')).toHaveCount(0);
  await expect(topBar.getByRole('button', { name: /Atelier Nord/ })).toBeVisible();
  await expect(topBar.getByRole('link', { name: 'Organisation' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '+ Créer un agent IA' })).toHaveCount(0);

  // l'organisation choisie est mémorisée (cookie) après rechargement
  await page.reload();
  await expect(page.getByText('Assistant atelier')).toBeVisible();
});

test('conseiller mono-organisation : ni sélecteur, ni Organisation, ni création', async ({ page }) => {
  await loginToAgents(page, 'advisor@wabagent.test');

  const topBar = page.getByRole('banner');
  await expect(page.getByText('Support technique')).toBeVisible();
  await expect(topBar.getByRole('link', { name: 'Organisation' })).toHaveCount(0);
  await expect(topBar.getByRole('button', { name: /Maison Lumière/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '+ Créer un agent IA' })).toHaveCount(0);

  // l'accès direct à l'espace Organisation ramène à la liste des agents IA
  await page.goto('/fr/organisation/entites');
  await expect(page).not.toHaveURL(/organisation/);
  await expect(page.getByRole('heading', { name: 'Tous les agents IA' })).toBeVisible();
});
