import { test, expect } from '@playwright/test';
import { loginToAgents, resetMock } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test('parcours onboarding complet : création, simulation, succès', async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');

  await page.getByRole('link', { name: '+ Créer un agent IA' }).click();

  // Étape 1 : identité (une seule entité active, donc pas de champ Entité)
  await page.getByLabel("Nom de l'agent IA").fill('Assistant Boutique');
  await expect(page.getByLabel('Entité', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /Continuer/ }).click();

  // Étape 2 : personnalité
  await expect(page.getByRole('heading', { name: 'La personnalité de votre agent IA' })).toBeVisible();
  await page.getByLabel('Rôle / métier').fill('Conseiller commercial');
  await page.getByRole('button', { name: /Créer & tester/ }).click();

  // Étape 3 : simulateur
  await expect(page.getByRole('heading', { name: 'Discutez avec votre agent IA' })).toBeVisible();
  await page.getByPlaceholder('Écrivez un message…').fill('Bonjour');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Réponse simulée à : Bonjour/)).toBeVisible();

  // Terminer : succès
  await page.getByRole('button', { name: /Terminer/ }).click();
  await expect(page.getByRole('heading', { name: 'Votre agent IA est prêt' })).toBeVisible();
});
