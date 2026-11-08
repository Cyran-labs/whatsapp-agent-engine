import { test, expect, type Page } from '@playwright/test';
import { loginToAgents, resetMock } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

/** Deuxième onglet (cookies partagés) qui bascule vers Atelier Nord. */
async function switchInOtherTab(first: Page): Promise<void> {
  const second = await first.context().newPage();
  await second.goto('/fr');
  await second.getByRole('banner').getByRole('button', { name: /Maison Lumière/ }).click();
  await second.getByRole('button', { name: /Atelier Nord/ }).click();
  await expect(second.getByText('Assistant atelier')).toBeVisible();
  await second.close();
}

test('bascule dans un autre onglet : un appel du premier onglet est refusé puis l\'onglet se recharge sur la bonne organisation', async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await expect(page.getByText('Support technique')).toBeVisible();
  await switchInOtherTab(page);

  // navigation côté client : la page Usage appelle le BFF avec X-Wab-Org = Maison Lumière, le cookie dit Atelier Nord
  await page.getByRole('banner').getByRole('link', { name: 'Usage & coûts' }).click();
  await expect(page).toHaveURL(/\/fr$/);
  await expect(page.getByText('Assistant atelier')).toBeVisible();
  await expect(page.getByRole('banner').getByRole('button', { name: /Atelier Nord/ })).toBeVisible();
});

test('bascule dans un autre onglet : au retour sur le premier onglet, rechargement sur l\'organisation active', async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await switchInOtherTab(page);

  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Assistant atelier')).toBeVisible();
  await expect(page.getByText('Support technique')).toHaveCount(0);
});
