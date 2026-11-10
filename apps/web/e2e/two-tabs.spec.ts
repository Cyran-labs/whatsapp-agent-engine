import { test, expect, type Page } from '@playwright/test';
import { failRoute, loginToAgents, msg, resetMock } from './helpers';

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
  // audit R-11 : le rechargement n'est pas silencieux, il dit ce qui s'est passé et nomme la nouvelle organisation
  await expect(page.getByRole('status').filter({ hasText: 'autre onglet' })).toHaveText(
    "Vous avez changé d'organisation dans un autre onglet : cet onglet affiche maintenant Atelier Nord.×",
  );
});

test('bascule dans un autre onglet : au retour sur le premier onglet, rechargement sur l\'organisation active', async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await switchInOtherTab(page);

  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Assistant atelier')).toBeVisible();
  await expect(page.getByText('Support technique')).toHaveCount(0);
  // audit R-11
  await expect(page.getByRole('status').filter({ hasText: 'autre onglet' })).toContainText('cet onglet affiche maintenant Atelier Nord.');
});

// audit R-13 : Studio Ocre (suspendue) est listée grisée, avec sa raison, et ne s'ouvre pas
test('le sélecteur liste l\'organisation suspendue grisée, non ouvrable, avec sa raison', async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.getByRole('banner').getByRole('button', { name: /Maison Lumière/ }).click();
  const row = page.getByRole('button', { name: /Studio Ocre/ });
  await expect(row).toHaveAttribute('aria-disabled', 'true');
  await expect(row).toContainText('Suspendue');
  await expect(row).toContainText("Ne peut pas être ouverte : contactez l'administrateur de l'organisation ou le support.");
  await row.click({ force: true });
  await expect(page.getByText('Support technique')).toBeVisible();
  await expect(page.getByRole('banner').getByRole('button', { name: 'Maison Lumière', exact: true })).toBeVisible();
});

// audit R-12 : un changement d'organisation refusé le dit dans le sélecteur ; audit R-14 (tâche 16b) : une panne serveur
// montre aussi la référence de la requête, sous le message
test('changement d\'organisation refusé : le message et la référence de la requête restent dans le sélecteur', async ({ page, request }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await failRoute(request, '/auth/me', 500, { requestId: 'req-org-switch' });
  await page.getByRole('banner').getByRole('button', { name: /Maison Lumière/ }).click();
  await page.getByRole('button', { name: /Atelier Nord/ }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'Impossible d' });
  await expect(alert.locator('p')).toHaveText([
    "Impossible d'ouvrir Atelier Nord : l'opération a échoué, réessayez.",
    msg('fr', 'errors.generic.reference', { reference: 'req-org-switch' }),
  ]);
  await expect(page.getByText('Support technique')).toBeVisible();
});
