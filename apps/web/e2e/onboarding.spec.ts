import { test, expect } from '@playwright/test';
import { failRoute, loginToAgents, refuseCreation, resetMock } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test('parcours onboarding complet : création, simulation, succès', async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');

  await page.getByRole('link', { name: 'Créer un agent IA', exact: true }).click();

  // Étape 1 : identité (une seule entité active, donc pas de champ Entité)
  await page.getByLabel("Nom de l'agent IA").fill('Assistant Boutique');
  await expect(page.getByLabel('Entité', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: /Continuer/ }).click();

  // Étape 2 : personnalité
  await expect(page.getByRole('heading', { name: 'La personnalité de votre agent IA' })).toBeVisible();
  await page.getByLabel('Rôle / métier').fill('Conseiller commercial');
  await page.getByRole('button', { name: /Créer et tester/ }).click();

  // Étape 3 : simulateur
  await expect(page.getByRole('heading', { name: 'Discutez avec votre agent IA' })).toBeVisible();
  await page.getByPlaceholder('Écrivez un message…').fill('Bonjour');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/Réponse simulée à : Bonjour/)).toBeVisible();

  // Étape 4 : numéro. Les numéros de l'organisation sont proposés ; « Plus tard » laisse l'agent IA en Draft
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByRole('heading', { name: 'Sur quel numéro répond-il ?' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: "Numéros WhatsApp de l'organisation" }).getByRole('radio')).toHaveCount(3);
  await page.getByRole('button', { name: 'Plus tard' }).click();

  // Fin : agent IA enregistré en Draft, pas encore activé (prototype 6)
  await expect(page.getByRole('heading', { name: 'Draft enregistré' })).toBeVisible();
  await expect(page.getByText('« Assistant Boutique » est enregistré en Draft.')).toBeVisible();
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Brancher un numéro' })).toBeVisible();
  await expect(page.getByText('Retour à la liste des agents IA')).toBeVisible();
});

// spec 12.1, prototype 6 : l'assistant garde le rail, la colonne (organisation, stepper vertical) et le fil
test("assistant dans le cadre normal : rail, bloc Organisation, fil d'Ariane, stepper vertical et encadré d'état", async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.getByRole('link', { name: 'Créer un agent IA', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Donnez vie à votre agent IA' })).toBeVisible();

  const rail = page.getByRole('navigation', { name: 'Navigation principale' });
  await expect(rail.getByRole('link', { name: 'Agents IA' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('[data-org-block]')).toContainText('Maison Lumière');
  const trail = page.getByRole('navigation', { name: "Fil d'Ariane" });
  await expect(trail.getByRole('listitem')).toHaveText(['Maison Lumière', 'Agents IA', 'Créer un agent IA']);
  await expect(page.getByText("Retour à Agents IA : rien n'est enregistré")).toBeVisible();

  const steps = page.getByRole('list', { name: "Étapes de l'assistant" });
  await expect(steps.getByRole('listitem')).toHaveCount(5);
  await expect(steps.getByRole('listitem').first()).toHaveAttribute('aria-current', 'step');
  await expect(steps.getByText('Rôle, ton, accueil, informations')).toBeVisible();
  // étape à venir : grisée, non cliquable, dit pourquoi au survol
  const later = steps.getByRole('link', { name: /Tester/ });
  await expect(later).toHaveAttribute('aria-disabled', 'true');
  await later.hover();
  await expect(page.getByRole('tooltip')).toHaveText("Disponible après « Créer et tester » à l'étape Personnalité : c'est là que l'agent IA est créé.");
  await expect(page.getByText("Rien n'est enregistré avant « Créer et tester » (étape 2).")).toBeVisible();

  await page.getByLabel("Nom de l'agent IA").fill('Assistant Boutique');
  await page.getByRole('button', { name: /Continuer/ }).click();
  await page.getByLabel('Rôle / métier').fill('Conseiller commercial');
  await page.getByRole('button', { name: /Créer et tester/ }).click();
  await expect(page.getByRole('heading', { name: 'Discutez avec votre agent IA' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Draft enregistré' })).toContainText('« Assistant Boutique » est dans la liste des agents IA, en Draft.');
  await expect(page.getByText('Retour à Agents IA : le Draft reste dans la liste')).toBeVisible();

  // étape atteinte : cliquable, ramène à la personnalité
  await steps.getByRole('button', { name: /Personnalité/ }).click();
  await expect(page.getByRole('heading', { name: 'La personnalité de votre agent IA' })).toBeVisible();
});

// spec 12.4, choix P-8 : confirmation de sortie seulement si une saisie serait perdue
test('« Quitter » avant la création : confirmation ; « Rester » garde la saisie, « Quitter sans enregistrer » ramène à la liste', async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.getByRole('link', { name: 'Créer un agent IA', exact: true }).click();
  await page.getByLabel("Nom de l'agent IA").fill('Assistant Perdu');

  await page.getByRole('button', { name: 'Quitter' }).click();
  const dialog = page.getByRole('dialog', { name: 'Quitter la création ?' });
  await expect(dialog).toContainText("Ce que vous avez saisi n'est pas encore enregistré.");
  await dialog.getByRole('button', { name: 'Rester' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("Nom de l'agent IA")).toHaveValue('Assistant Perdu');

  // même confirmation depuis le rail
  await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Agents IA' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Quitter sans enregistrer' }).click();
  await expect(page.getByRole('heading', { name: 'Agents IA', exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: /Assistant Perdu/ })).toHaveCount(0);
});

test('après la création, sans saisie en attente : « Quitter » ramène à la liste sans fenêtre, le Draft y est', async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.getByRole('link', { name: 'Créer un agent IA', exact: true }).click();
  await page.getByLabel("Nom de l'agent IA").fill('Assistant Gardé');
  await page.getByRole('button', { name: /Continuer/ }).click();
  await page.getByLabel('Rôle / métier').fill('Conseiller commercial');
  await page.getByRole('button', { name: /Créer et tester/ }).click();
  await expect(page.getByRole('heading', { name: 'Discutez avec votre agent IA' })).toBeVisible();

  await page.getByRole('button', { name: 'Quitter' }).click();
  await expect(page.getByRole('heading', { name: 'Agents IA', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('row', { name: /Assistant Gardé/ }).getByText('Draft', { exact: true })).toBeVisible();
});

/** Connexion, étape 1 remplie, étape 2 : rôle saisi, prête à créer. */
async function reachPersonality(page: import('@playwright/test').Page): Promise<void> {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.getByRole('link', { name: 'Créer un agent IA', exact: true }).click();
  await page.getByLabel("Nom de l'agent IA").fill('Assistant Boutique');
  await page.getByRole('button', { name: /Continuer/ }).click();
  await expect(page.getByRole('heading', { name: 'La personnalité de votre agent IA' })).toBeVisible();
  await page.getByLabel('Rôle / métier').fill('Conseiller commercial');
}

// audit R-2
test('panne du moteur à la création : message propre et référence sous le bouton, jamais « Vérifiez les champs »', async ({ page, request }) => {
  await reachPersonality(page);
  await failRoute(request, '/bots', 500);
  await page.getByRole('button', { name: /Créer et tester/ }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'Action impossible' });
  await expect(alert).toContainText('Action impossible pour le moment. Réessayez.');
  await expect(alert).toContainText('Référence : r');
  await expect(page.getByText(/Vérifiez les champs/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Créer et tester/ })).toBeEnabled();
});

// audit R-2
test("refus de l'entité par le moteur : retour à l'étape 1 avec le message", async ({ page, request }) => {
  await reachPersonality(page);
  await refuseCreation(request, 'bot.entity_required');
  await page.getByRole('button', { name: /Créer et tester/ }).click();
  await expect(page.getByRole('heading', { name: 'Donnez vie à votre agent IA' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Choisissez une entité.' })).toBeVisible();
});

// audit R-2
test('refus de la langue par défaut : le champ de la personnalité est en erreur, avec un texte qui nomme la langue', async ({ page, request }) => {
  await reachPersonality(page);
  await refuseCreation(request, 'bot.default_language_missing');
  await page.getByRole('button', { name: /Créer et tester/ }).click();
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
