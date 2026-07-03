import { test, expect } from '@playwright/test';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/fr/login');
  await page.getByLabel('Adresse e-mail').fill('demo@wabagent.test');
  await page.getByLabel('Mot de passe').fill('motdepasse12');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
}

test("table d'agents → espace agent → Vue d'ensemble → Usage", async ({ page }) => {
  await login(page);

  // La table liste l'agent pré-seedé
  await expect(page.getByText('Support technique')).toBeVisible();

  // Clic sur la ligne → espace agent
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
