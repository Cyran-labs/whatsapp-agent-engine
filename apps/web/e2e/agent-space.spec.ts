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
