import { test, expect } from '@playwright/test';
import { failRoute, loginToAgents, rail, resetMock } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test("création d'une entité puis d'un agent IA rattaché : colonne Entité visible", async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');

  // avec une seule entité active, la liste n'a pas de colonne Entité
  await expect(page.getByRole('columnheader', { name: 'Entité' })).toHaveCount(0);

  await rail(page).getByRole('link', { name: 'Organisation' }).click();
  await expect(page.getByRole('heading', { name: 'Entités' })).toBeVisible();
  await page.getByRole('button', { name: '+ Nouvelle entité' }).click();
  await page.getByLabel("Nom de l'entité").fill('Boutique Lyon');
  await page.getByLabel("Nom de l'entité").press('Enter');
  await expect(page.getByRole('cell', { name: 'Boutique Lyon' })).toBeVisible();
  await expect(page.getByText('2 entités actives')).toBeVisible();

  // création d'un agent IA : l'entité est maintenant à choisir
  await page.goto('/fr/agents/new');
  await page.getByLabel("Nom de l'agent IA").fill('Assistant Lyon');
  await expect(page.getByRole('button', { name: /Continuer/ })).toBeDisabled();
  await page.getByLabel('Entité', { exact: true }).selectOption({ label: 'Boutique Lyon' });
  await page.getByRole('button', { name: /Continuer/ }).click();
  await page.getByLabel('Rôle / métier').fill('Conseiller commercial');
  await page.getByRole('button', { name: /Créer & tester/ }).click();
  await expect(page.getByRole('heading', { name: 'Discutez avec votre agent IA' })).toBeVisible();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByRole('heading', { name: 'Sur quel numéro répond-il ?' })).toBeVisible();
  await page.getByRole('button', { name: 'Plus tard' }).click();
  await page.getByRole('button', { name: 'Retour aux agents IA' }).click();

  // la liste montre la colonne Entité et le rattachement
  await expect(page.getByRole('columnheader', { name: 'Entité' })).toBeVisible();
  const row = page.getByRole('row', { name: /Assistant Lyon/ });
  await expect(row.getByText('Boutique Lyon')).toBeVisible();
  await expect(page.getByRole('row', { name: /Support technique/ }).getByText('Boutique Paris')).toBeVisible();
});

test("invitation : même message de confirmation pour une adresse nouvelle ou déjà connue", async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.goto('/fr/organisation/utilisateurs');
  await expect(page.getByRole('heading', { name: 'Utilisateurs' })).toBeVisible();
  // membres (2) + invitation en attente (1)
  await expect(page.getByText('2 membres · 1 invitation en attente')).toBeVisible();

  for (const email of ['inconnu@wabagent.test', 'advisor@wabagent.test']) {
    await page.getByRole('button', { name: '+ Inviter' }).click();
    const drawer = page.getByRole('dialog');
    await drawer.getByLabel('Adresse e-mail').fill(email);
    await drawer.getByRole('checkbox', { name: 'Boutique Paris' }).check();
    await drawer.getByRole('button', { name: "Envoyer l'invitation" }).click();
    await expect(page.getByText(`Invitation envoyée à ${email}.`)).toBeVisible();
    await expect(drawer).toHaveCount(0);
  }
  await expect(page.getByText('2 membres · 3 invitations en attente')).toBeVisible();
});

test('réglages de visibilité : seul le mode « Tout le monde voit tout » est disponible', async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.goto('/fr/organisation/reglages');
  await expect(page.getByRole('heading', { name: 'Réglages' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Tout le monde voit tout/ })).toHaveAttribute('aria-checked', 'true');
});

test('révocation d\'une invitation : « Gérer » visible, confirmation, notification de réussite, ligne retirée', async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.goto('/fr/organisation/utilisateurs');
  await expect(page.getByText('2 membres · 1 invitation en attente')).toBeVisible();

  const row = page.getByRole('row', { name: /nouveau@wabagent\.test/ });
  await expect(row.getByRole('button', { name: 'Gérer (nouveau@wabagent.test)' })).toBeVisible();
  await row.getByRole('button', { name: 'Gérer (nouveau@wabagent.test)' }).click();
  await page.getByRole('menuitem', { name: 'Révoquer' }).click();

  const dialog = page.getByRole('dialog', { name: "Révoquer l'invitation à nouveau@wabagent.test ?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: 'Gérer (nouveau@wabagent.test)' }).click();
  await page.getByRole('menuitem', { name: 'Révoquer' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Révoquer' }).click();
  await expect(page.getByRole('region', { name: 'Notifications' })).toContainText('Invitation à nouveau@wabagent.test révoquée.');
  await expect(page.getByText('2 membres · 0 invitation en attente')).toBeVisible();
  await expect(page.getByRole('row', { name: /nouveau@wabagent\.test/ })).toHaveCount(0);
});

test('entités : chaque ligne porte un bouton « Gérer » visible, la lecture en échec propose Réessayer', async ({ page, request }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.goto('/fr/organisation/entites');
  await expect(page.getByRole('button', { name: /^Gérer \(/ }).first()).toBeVisible();

  await failRoute(request, '/entities', 500);
  await page.reload();
  await expect(page.getByText('Impossible de charger les entités.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Réessayer' })).toBeVisible();
  await resetMock(request);
  await page.getByRole('button', { name: 'Réessayer' }).click();
  await expect(page.getByRole('button', { name: /^Gérer \(/ }).first()).toBeVisible();
});

/** Vrai si l'élément reçoit réellement le clic en son centre (pas rogné par un conteneur qui masque son dépassement). */
async function isHittable(item: import('@playwright/test').Locator): Promise<boolean> {
  return item.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return hit === el || el.contains(hit);
  });
}

// recette 10 nov. 2026 : le menu « Gérer » de la dernière ligne d'un tableau était coupé par le bord de la carte.
test('entités : tous les choix du menu « Gérer » de la dernière ligne sont atteignables', async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.goto('/fr/organisation/entites');
  // « Archiver… » n'existe qu'avec au moins deux entités actives : on en crée une, qui devient la dernière ligne
  await page.getByRole('button', { name: '+ Nouvelle entité' }).click();
  await page.getByLabel("Nom de l'entité").fill('Boutique Lyon');
  await page.getByLabel("Nom de l'entité").press('Enter');
  await expect(page.getByRole('cell', { name: 'Boutique Lyon' })).toBeVisible();
  const last = page.getByRole('row', { name: /Boutique Lyon/ });
  await last.getByRole('button', { name: /^Gérer \(/ }).click();
  const menu = page.getByRole('menu');
  const items = menu.getByRole('menuitem');
  const count = await items.count();
  expect(count).toBe(3);
  for (let i = 0; i < count; i += 1) {
    await expect(items.nth(i)).toBeVisible();
    expect(await isHittable(items.nth(i))).toBe(true);
  }
  await page.getByRole('menuitem', { name: /^Archiver/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('invitations en attente : le choix « Révoquer » de la dernière ligne est atteignable', async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.goto('/fr/organisation/utilisateurs');
  const row = page.getByRole('row', { name: /nouveau@wabagent\.test/ });
  await row.getByRole('button', { name: 'Gérer (nouveau@wabagent.test)' }).click();
  const items = page.getByRole('menu').getByRole('menuitem');
  const count = await items.count();
  for (let i = 0; i < count; i += 1) expect(await isHittable(items.nth(i))).toBe(true);
  await expect(page.getByRole('menuitem', { name: 'Révoquer' })).toBeVisible();
});
