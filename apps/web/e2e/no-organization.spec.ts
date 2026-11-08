import { test, expect } from '@playwright/test';
import { login, resetMock } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test('compte sans organisation accessible : page « aucune organisation », Mon compte accessible', async ({ page }) => {
  // seule appartenance suspendue : /auth/me renvoie organizations: []
  await login(page, 'suspendu@wabagent.test');
  await expect(page).toHaveURL(/\/fr\/no-organization$/);
  await expect(page.getByRole('heading', { name: 'Aucune organisation' })).toBeVisible();
  await expect(page.getByText("Vous n'avez accès à aucune organisation pour le moment.", { exact: false })).toBeVisible();

  // l'app (liste des agents IA) renvoie sur la même page, sans boucle
  await page.goto('/fr');
  await expect(page).toHaveURL(/\/fr\/no-organization$/);

  await page.getByRole('link', { name: 'Mon compte' }).click();
  await expect(page).toHaveURL(/\/fr\/account\/preferences$/);
  await expect(page.getByRole('heading', { name: 'Préférences' })).toBeVisible();
  await page.getByRole('link', { name: 'Sécurité' }).click();
  await expect(page.getByLabel('Mot de passe actuel')).toBeVisible();

  await page.goto('/fr/no-organization');
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page).toHaveURL(/\/fr\/login$/);
});
