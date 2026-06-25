import { test, expect } from '@playwright/test';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/fr/login');
  await page.getByLabel('Adresse e-mail').fill('demo@wabagent.test');
  await page.getByLabel('Mot de passe').fill('motdepasse12');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { name: 'Bienvenue sur WABAGENT' })).toBeVisible();
}

test('parcours onboarding complet : creation + simulation + succes', async ({ page }) => {
  await login(page);

  await page.getByRole('link', { name: /Créer mon premier agent/ }).click();

  // Etape 1 — Identite
  await page.getByLabel('Nom de l\'agent').fill('Assistant Boutique');
  await page.getByRole('button', { name: /Continuer/ }).click();

  // Etape 2 — Personnalite
  await expect(page.getByRole('heading', { name: 'La personnalité de votre agent' })).toBeVisible();
  await page.getByLabel('Rôle / métier').fill('Conseiller commercial');
  await page.getByRole('button', { name: /Créer & tester/ }).click();

  // Etape 3 — Simulateur
  await expect(page.getByRole('heading', { name: 'Discutez avec votre agent' })).toBeVisible();
  await page.getByPlaceholder('Écrivez un message…').fill('Bonjour');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Réponse simulée à : Bonjour/)).toBeVisible();

  // Terminer -> Succes
  await page.getByRole('button', { name: /Terminer/ }).click();
  await expect(page.getByRole('heading', { name: 'Votre agent est prêt' })).toBeVisible();
});
