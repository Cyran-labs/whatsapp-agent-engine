import { test, expect, type Page } from '@playwright/test';
import { login, loginToAgents, makeEngineUnreachable, msg, orgSwitcher, rail, resetMock } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

const UNREADABLE = msg('fr', 'shell.sessionUnreadable.title');

/** Écran global d'avant la correction (`common.error`, cadre perdu) : jamais affiché quand le moteur ne répond pas. */
async function expectNoGlobalError(page: Page): Promise<void> {
  await expect(page.getByText(msg('fr', 'common.error'))).toHaveCount(0);
}

// recette 3.1 (RECETTE 5.3) : moteur arrêté, navigation depuis la liste ; la session n'est pas relue, la page dit son
// propre échec et le cadre de la session reste
test('moteur coupé pendant la navigation : rail et colonne gardés, échec de la page sur place', async ({ page, request }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await makeEngineUnreachable(request);
  await rail(page).getByRole('link', { name: 'Organisation' }).click();
  await expect(page).toHaveURL(/\/fr\/organisation\/entites$/);
  await expect(page.getByText(msg('fr', 'organisation.entities.loadError'))).toBeVisible();
  await expect(rail(page).getByRole('link', { name: 'Agents IA' })).toBeVisible();
  await expect(orgSwitcher(page)).toContainText('Maison Lumière');
  await expectNoGlobalError(page);
});

// recette 3.1 : cause de l'écran global, la session lue au chargement d'une page de l'app ; cadre neutre puis « Réessayer »
test('page de l\'app rechargée moteur coupé : titre sur place, cadre neutre, puis « Réessayer »', async ({ page, request }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await makeEngineUnreachable(request);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: UNREADABLE })).toBeVisible();
  await expectNoGlobalError(page);
  // entête 5 : aucune donnée d'organisation d'une session précédente
  await expect(page.locator('body')).not.toContainText('Maison Lumière');
  await expect(page.locator('[data-org-block]')).toHaveCount(0);
  await expect(rail(page).getByRole('link', { name: 'Agents IA' })).toHaveCount(0);
  await expect(rail(page).getByRole('link', { name: msg('fr', 'shell.rail.account') })).toBeVisible();
  await resetMock(request);
  await page.getByRole('button', { name: msg('fr', 'common.retry') }).click();
  await expect(page.getByRole('heading', { name: 'Agents IA', exact: true })).toBeVisible();
  await expect(orgSwitcher(page)).toContainText('Maison Lumière');
});

// recette 3.1 (RECETTE 11) : « Mon compte » depuis « Aucune organisation » moteur coupé, première lecture de la session de l'app
test('« Mon compte » depuis « Aucune organisation » moteur coupé : titre sur place, jamais l\'écran global', async ({ page, request }) => {
  await login(page, 'suspendu@wabagent.test');
  await expect(page.getByText('Studio Ocre est suspendue. Contactez le support.')).toBeVisible();
  await makeEngineUnreachable(request);
  await page.getByRole('link', { name: msg('fr', 'noOrganization.account') }).click();
  await expect(page.getByRole('heading', { level: 1, name: UNREADABLE })).toBeVisible();
  await expectNoGlobalError(page);
});

// recette 3.1 (RECETTE 11) : page « Aucune organisation » rechargée moteur coupé
test('« Aucune organisation » rechargée moteur coupé : message de lecture, puis « Réessayer » relit la page', async ({ page, request }) => {
  await login(page, 'suspendu@wabagent.test');
  await expect(page).toHaveURL(/\/fr\/no-organization$/);
  await makeEngineUnreachable(request);
  await page.reload();
  await expect(page.getByText(UNREADABLE)).toBeVisible();
  await expectNoGlobalError(page);
  await resetMock(request);
  await page.getByRole('button', { name: msg('fr', 'common.retry') }).click();
  await expect(page.getByText('Studio Ocre est suspendue. Contactez le support.')).toBeVisible();
  await expect(page.getByText(UNREADABLE)).toHaveCount(0);
});

// entête, point d'attention 4 : écriture pendant la coupure, refus « serveur » à l'endroit de l'action, cadre gardé
test('renommer une entité moteur coupé : refus sur la ligne avec le texte de l\'action, URL inchangée, pas de connexion', async ({ page, request }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.goto('/fr/organisation/entites');
  const row = page.getByRole('row', { name: /Boutique Paris/ });
  await row.getByRole('button', { name: /^Gérer \(/ }).click();
  await page.getByRole('menuitem', { name: msg('fr', 'organisation.entities.menu.rename') }).click();
  await makeEngineUnreachable(request);
  await page.getByLabel(msg('fr', 'organisation.entities.nameLabel')).fill('Boutique Centre');
  await page.getByRole('button', { name: msg('fr', 'organisation.entities.save') }).click();
  await expect(page.getByRole('row').filter({ hasText: msg('fr', 'errors.generic.server') })).toBeVisible();
  await expect(page).toHaveURL(/\/fr\/organisation\/entites$/);
  await expect(rail(page)).toBeVisible();
  await expect(orgSwitcher(page)).toContainText('Maison Lumière');
  await expectNoGlobalError(page);
});

/** Vrai si le texte du titre tient dans sa boîte (aucune troncature par des points de suspension). */
async function titleFits(page: Page): Promise<boolean> {
  return page.locator('h1').evaluate((h1) => h1.scrollWidth <= h1.clientWidth + 1);
}

// recette phase F : à faible largeur, le message de lecture passe à la ligne au lieu d'être tronqué
test('session illisible à faible largeur : le message du titre passe à la ligne, jamais tronqué', async ({ page, request }) => {
  await page.setViewportSize({ width: 560, height: 800 });
  await loginToAgents(page, 'demo@wabagent.test');
  await makeEngineUnreachable(request);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: UNREADABLE })).toBeVisible();
  expect(await titleFits(page)).toBe(true);
});

// recette phase F : page « Aucune organisation » à faible largeur, session illisible : le titre est le message, entier,
// et le rail réduit est là (décision 19-18)
test('« Aucune organisation » illisible à faible largeur : titre du message entier, rail réduit, jamais « Aucune organisation »', async ({ page, request }) => {
  await page.setViewportSize({ width: 560, height: 800 });
  await login(page, 'suspendu@wabagent.test');
  await expect(page).toHaveURL(/\/fr\/no-organization$/);
  await expect(rail(page).getByRole('link', { name: msg('fr', 'shell.rail.account'), exact: false })).toBeVisible();
  await expect(rail(page).getByRole('link', { name: 'Agents IA' })).toHaveCount(0);
  await makeEngineUnreachable(request);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: UNREADABLE })).toBeVisible();
  await expect(page.getByText(msg('fr', 'noOrganization.title'))).toHaveCount(0);
  expect(await titleFits(page)).toBe(true);
});
