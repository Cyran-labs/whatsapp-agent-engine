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

  // Étape 4 : numéro. Les numéros de l'organisation sont proposés ; « Plus tard » laisse l'agent IA en brouillon
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByRole('heading', { name: 'Sur quel numéro répond-il ?' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: "Numéros WhatsApp de l'organisation" }).getByRole('radio')).toHaveCount(3);
  await page.getByRole('button', { name: 'Plus tard' }).click();

  // Succès : agent IA créé en brouillon, pas encore en ligne
  await expect(page.getByRole('heading', { name: 'Votre agent IA est prêt' })).toBeVisible();
  await expect(page.getByText('« Assistant Boutique » est créé en brouillon.')).toBeVisible();
  await expect(page.getByText('Brouillon', { exact: true })).toBeVisible();
});
