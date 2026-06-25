import { test, expect } from '@playwright/test';

test('login échoue avec un mauvais mot de passe', async ({ page }) => {
  await page.goto('/fr/login');
  await page.getByLabel('Adresse e-mail').fill('demo@wabagent.test');
  await page.getByLabel('Mot de passe').fill('mauvais-mdp1');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'Identifiants invalides.' });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('Identifiants invalides.');
});

test('login réussit et atterrit sur le shell', async ({ page }) => {
  await page.goto('/fr/login');
  await page.getByLabel('Adresse e-mail').fill('demo@wabagent.test');
  await page.getByLabel('Mot de passe').fill('motdepasse12');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { name: 'Bienvenue sur WABAGENT' })).toBeVisible();
});

test('route protégée sans session → redirige vers login', async ({ page }) => {
  await page.goto('/fr');
  await expect(page).toHaveURL(/\/fr\/login$/);
});
