import { test, expect } from '@playwright/test';
import { loginToAgents, resetMock } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test("table d'agents IA, espace agent IA, Vue d'ensemble, Usage", async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');

  // La table liste l'agent IA pré-seedé
  await expect(page.getByText('Support technique')).toBeVisible();

  // Clic sur la ligne : espace agent IA
  await page.getByText('Support technique').click();
  await page.waitForURL('**/agents/demo-1');

  // Vue d'ensemble : bloc Santé + métrique 142 messages
  await expect(page.getByText('Santé')).toBeVisible();
  await expect(page.getByText('142')).toBeVisible();

  // Navigation vers Usage & coûts
  await page.getByRole('link', { name: 'Usage & coûts' }).click();
  await page.waitForURL('**/agents/demo-1/usage');

  // Détail par modèle + ligne Total
  await expect(page.getByText('claude-haiku-4-5')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Total' })).toBeVisible();
});

// recette Q-1, recette Q-10 et point d'attention 3 du plan : statuts en mots d'activation, liste vide permise et expliquée
test("statuts d'activation et liste d'accès limité vide : enregistrée, expliquée, puis désactiver et réactiver", async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.getByText('Support technique').click();
  await page.waitForURL('**/agents/demo-1');
  const status = page.getByRole('region', { name: 'Statut' });
  const list = page.getByRole('region', { name: 'Accès limité' });
  await expect(status.getByText('Ouvert à tous', { exact: true })).toBeVisible();
  // aucun bouton ne parle de brouillon ni de pause
  await expect(status.getByRole('button', { name: /brouillon|pause/i })).toHaveCount(0);

  // liste vide : revenir en accès limité est indisponible, la raison propose « Ajouter un numéro » qui met le focus sur le champ
  await expect(status.getByRole('button', { name: 'Revenir en accès limité' })).toBeDisabled();
  await status.getByRole('button', { name: 'Ajouter un numéro' }).click();
  await expect(page.getByLabel('Numéro à autoriser')).toBeFocused();
  await page.getByLabel('Numéro à autoriser').fill('+33611223344');
  await list.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await list.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(list.getByText('Liste enregistrée.')).toBeVisible();
  await status.getByRole('button', { name: 'Revenir en accès limité' }).click();
  await expect(status.getByText('Accès limité', { exact: true })).toBeVisible();

  // recette Q-10 : vider la liste puis enregistrer est permis, l'encart dit ce que cela veut dire
  await list.getByRole('button', { name: /^Retirer/ }).click();
  await list.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(list.getByText('Liste enregistrée.')).toBeVisible();
  await expect(status.getByRole('status')).toHaveText("Cet agent IA ne répond à personne : sa liste d'accès limité est vide.");
  const notice = status.getByRole('status').locator('..');
  // un seul bouton de chaque nom : l'encart porte les actions, la rangée ne les répète pas
  for (const name of ['Ajouter un numéro', 'Ouvrir à tous', 'Désactiver']) {
    await expect(status.getByRole('button', { name })).toHaveCount(1);
    await expect(notice.getByRole('button', { name })).toBeEnabled();
  }

  // Désactiver (confirmé), puis réactiver en accès limité est refusé tant que la liste est vide
  await notice.getByRole('button', { name: 'Désactiver' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Désactiver' }).click();
  await expect(status.getByText('Désactivé', { exact: true })).toBeVisible();
  await expect(status.getByRole('button', { name: 'Réactiver en accès limité' })).toBeDisabled();
  await expect(status.getByText("Ajoutez au moins un numéro à la liste d'accès limité.")).toBeVisible();
  await expect(status.getByRole('button', { name: 'Réactiver pour tous' })).toBeEnabled();
  await status.getByRole('button', { name: 'Ajouter un numéro' }).click();
  await expect(page.getByLabel('Numéro à autoriser')).toBeFocused();

  // une entrée de plus : la réactivation en accès limité est permise
  await page.getByLabel('Numéro à autoriser').fill('+33699887766');
  await list.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await list.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(list.getByText('Liste enregistrée.')).toBeVisible();
  await status.getByRole('button', { name: 'Réactiver en accès limité' }).click();
  await expect(status.getByText('Accès limité', { exact: true })).toBeVisible();
  await expect(status.getByRole('button', { name: 'Désactiver' })).toBeVisible();
});
