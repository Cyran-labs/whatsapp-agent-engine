import { test, expect } from '@playwright/test';
import { PASSWORD, lastResetLink, loginToAgents, resetMock } from './helpers';

const NEW_PASSWORD = 'nouveaumdp123';

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test('mot de passe oublié puis réinitialisation, puis connexion avec le nouveau', async ({ page }) => {
  await page.goto('/fr/login');
  await page.getByRole('link', { name: 'Mot de passe oublié ?' }).click();
  await expect(page.getByRole('heading', { name: 'Mot de passe oublié' })).toBeVisible();

  // même confirmation que le compte existe ou non
  await page.getByLabel('Adresse e-mail').fill('inconnu@wabagent.test');
  await page.getByRole('button', { name: 'Recevoir un lien' }).click();
  await expect(page.getByRole('status')).toContainText('Si un compte existe pour cette adresse, un lien vous a été envoyé.');
  await expect(page.getByText(/reset-ok/)).toHaveCount(0);

  // le lien reçu par e-mail
  await page.goto('/fr/reset-password?token=reset-ok');
  await page.getByLabel('Nouveau mot de passe').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Enregistrer' }).click();

  await expect(page).toHaveURL(/\/fr\/login\?reset=1$/);
  await expect(page.getByRole('status')).toContainText('Mot de passe modifié. Connectez-vous avec le nouveau.');

  await page.getByLabel('Adresse e-mail').fill('demo@wabagent.test');
  await page.getByLabel('Mot de passe').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { name: 'Tous les agents IA' })).toBeVisible();
});

test("depuis l'invitation : mot de passe oublié, lien avec invite, réinitialisation, retour à l'invitation", async ({ page, request }) => {
  await page.goto('/fr/accept-invite?token=invite-existing');
  await expect(page.getByRole('heading', { name: 'Connectez-vous pour accepter' })).toBeVisible();
  await page.getByRole('link', { name: 'Mot de passe oublié ?' }).click();
  await expect(page).toHaveURL(/\/fr\/forgot-password\?invite=invite-existing$/);

  await page.getByLabel('Adresse e-mail').fill('advisor@wabagent.test');
  await page.getByRole('button', { name: 'Recevoir un lien' }).click();
  await expect(page.getByRole('status')).toContainText('Si un compte existe pour cette adresse, un lien vous a été envoyé.');

  // le lien « reçu par e-mail » ramène à l'invitation
  const link = await lastResetLink(request);
  expect(link).toMatch(/^\/reset-password\?token=reset-\d+&invite=invite-existing$/);
  await page.goto(`/fr${link}`);
  await page.getByLabel('Nouveau mot de passe').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Enregistrer' }).click();

  await expect(page).toHaveURL(/\/fr\/accept-invite\?token=invite-existing$/);
  await page.getByLabel('Adresse e-mail').fill('advisor@wabagent.test');
  await page.getByLabel('Mot de passe').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('heading', { name: 'Rejoindre Atelier Nord ?' })).toBeVisible();
});

test("mot de passe oublié depuis une invitation d'une autre adresse : lien sans invite", async ({ page, request }) => {
  await page.goto('/fr/forgot-password?invite=invite-existing');
  await page.getByLabel('Adresse e-mail').fill('demo@wabagent.test');
  await page.getByRole('button', { name: 'Recevoir un lien' }).click();
  await expect(page.getByRole('status')).toBeVisible();
  expect(await lastResetLink(request)).toMatch(/^\/reset-password\?token=reset-\d+$/);
});

test('lien de réinitialisation expiré ou déjà utilisé', async ({ page }) => {
  await page.goto('/fr/reset-password?token=reset-perime');
  await page.getByLabel('Nouveau mot de passe').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Lien de réinitialisation invalide ou expiré.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Recevoir un nouveau lien' })).toBeVisible();
});

test('Mon compte : changement du mot de passe sous session', async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.goto('/fr/account/securite');

  await page.getByLabel('Mot de passe actuel').fill('mauvais-mdp1');
  await page.getByLabel('Nouveau mot de passe').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Changer le mot de passe' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Mot de passe actuel incorrect.' })).toBeVisible();

  await page.getByLabel('Mot de passe actuel').fill(PASSWORD);
  await page.getByRole('button', { name: 'Changer le mot de passe' }).click();
  await expect(page.getByRole('status')).toContainText('Mot de passe modifié. Vos autres sessions ont été déconnectées.');
});
