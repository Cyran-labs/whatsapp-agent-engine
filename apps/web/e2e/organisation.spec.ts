import { test, expect } from '@playwright/test';
import { loginToAgents, resetMock } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test("création d'une entité puis d'un agent IA rattaché : colonne Entité visible", async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');

  // avec une seule entité active, la liste n'a pas de colonne Entité
  await expect(page.getByRole('columnheader', { name: 'Entité' })).toHaveCount(0);

  await page.getByRole('banner').getByRole('link', { name: 'Organisation' }).click();
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
    await expect(page.getByText(`Invitation envoyée à ${email}`)).toBeVisible();
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
