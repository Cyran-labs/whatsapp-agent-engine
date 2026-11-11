import { test, expect } from '@playwright/test';
import { failRoute, loginToAgents, refuseCreation, resetMock } from './helpers';

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
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();
});

/** Connexion, étape 1 remplie, étape 2 : rôle saisi, prête à créer. */
async function reachPersonality(page: import('@playwright/test').Page): Promise<void> {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.getByRole('link', { name: '+ Créer un agent IA' }).click();
  await page.getByLabel("Nom de l'agent IA").fill('Assistant Boutique');
  await page.getByRole('button', { name: /Continuer/ }).click();
  await expect(page.getByRole('heading', { name: 'La personnalité de votre agent IA' })).toBeVisible();
  await page.getByLabel('Rôle / métier').fill('Conseiller commercial');
}

// audit R-2
test('panne du moteur à la création : message propre et référence sous le bouton, jamais « Vérifiez les champs »', async ({ page, request }) => {
  await reachPersonality(page);
  await failRoute(request, '/bots', 500);
  await page.getByRole('button', { name: /Créer & tester/ }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'Action impossible' });
  await expect(alert).toContainText('Action impossible pour le moment. Réessayez.');
  await expect(alert).toContainText('Référence : r');
  await expect(page.getByText(/Vérifiez les champs/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Créer & tester/ })).toBeEnabled();
});

// audit R-2
test("refus de l'entité par le moteur : retour à l'étape 1 avec le message", async ({ page, request }) => {
  await reachPersonality(page);
  await refuseCreation(request, 'bot.entity_required');
  await page.getByRole('button', { name: /Créer & tester/ }).click();
  await expect(page.getByRole('heading', { name: 'Donnez vie à votre agent IA' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Choisissez une entité.' })).toBeVisible();
});

// audit R-2
test('refus de la langue par défaut : le champ de la personnalité est en erreur, avec un texte qui nomme la langue', async ({ page, request }) => {
  await reachPersonality(page);
  await refuseCreation(request, 'bot.default_language_missing');
  await page.getByRole('button', { name: /Créer & tester/ }).click();
  await expect(page.getByText("Décrivez la personnalité de l'agent IA en français, la langue par défaut.")).toBeVisible();
  await expect(page.getByLabel('Rôle / métier')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText(/Vérifiez les champs/)).toHaveCount(0);
});

// recette Q-12, recette Q-13
test('informations à collecter : bouton Ajouter, note sur la visibilité', async ({ page }) => {
  await reachPersonality(page);
  await expect(page.getByText('Elles ne sont pas encore visibles dans WABAGENT ni envoyées à votre CRM', { exact: false })).toBeVisible();
  await page.getByLabel('Ajouter un champ').fill('e-mail');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByText('e-mail')).toBeVisible();
  await expect(page.getByLabel('Ajouter un champ')).toHaveValue('');
});
