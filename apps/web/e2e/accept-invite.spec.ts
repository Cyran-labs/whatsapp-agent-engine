import { test, expect } from '@playwright/test';
import { orgSwitcher, PASSWORD, rail, resetMock } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test('invitation pour un compte neuf : choix du mot de passe et arrivée dans l\'organisation', async ({ page }) => {
  await page.goto('/fr/accept-invite?token=invite-new');
  // prototype 14 : titre et bouton unifiés, rôle et entité montrés, adresse masquée expliquée
  await expect(page.getByRole('heading', { name: 'Activez votre compte' })).toBeVisible();
  await expect(page.getByText('Conseiller · Boutique Paris')).toBeVisible();
  // adresse masquée, jamais l'adresse complète ni le lien
  await expect(page.getByTestId('email-hint')).toHaveText('n•••••@wabagent.test');
  await expect(page.getByText("C'est l'adresse qui a reçu cette invitation ; elle servira d'identifiant.")).toBeVisible();

  await page.getByLabel('Mot de passe').fill('court');
  await page.getByRole('button', { name: 'Activer mon compte' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'au moins 10 caractères' })).toBeVisible();

  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Activer mon compte' }).click();

  await expect(page.getByRole('heading', { name: 'Agents IA', exact: true })).toBeVisible();
  await expect(page.getByText('Bienvenue dans Maison Lumière.')).toBeVisible();
  await expect(page.getByText('Support technique')).toBeVisible();
  // conseiller d'entité : pas d'entrée Organisation
  await expect(rail(page).getByRole('link', { name: 'Organisation' })).toHaveCount(0);
});

test('invitation pour un compte existant : connexion puis acceptation', async ({ page }) => {
  await page.goto('/fr/accept-invite?token=invite-existing');
  await expect(page.getByRole('heading', { name: 'Connectez-vous pour accepter' })).toBeVisible();

  await page.getByLabel('Adresse e-mail').fill('advisor@wabagent.test');
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();

  await expect(page.getByRole('heading', { name: 'Rejoindre Atelier Nord ?' })).toBeVisible();
  // spec 6.4 : « depuis le bandeau » remplacé
  await expect(page.getByText('depuis le bloc Organisation, en haut de la colonne de gauche', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: "Accepter l'invitation" }).click();

  await expect(page.getByText('Bienvenue dans Atelier Nord.')).toBeVisible();
  await expect(page.getByText('Assistant atelier')).toBeVisible();
  // le compte a maintenant deux organisations : le sélecteur apparaît dans le bloc Organisation
  await expect(orgSwitcher(page)).toContainText('Atelier Nord');
  await orgSwitcher(page).click();
  await expect(page.getByRole('button', { name: /Maison Lumière/ })).toBeVisible();
});

test('invitation destinée à une autre adresse : proposition de changer de compte', async ({ page }) => {
  await page.goto('/fr/accept-invite?token=invite-existing');
  await page.getByLabel('Adresse e-mail').fill('demo@wabagent.test');
  await page.getByLabel('Mot de passe').fill(PASSWORD);
  await page.getByRole('button', { name: 'Se connecter' }).click();

  await expect(page.getByText(/Cette invitation est destinée à/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Changer de compte' })).toBeVisible();
  await expect(page.getByRole('button', { name: "Accepter l'invitation" })).toHaveCount(0);
});

test('invitation avec un jeton inconnu ou absent : lien non valable', async ({ page }) => {
  await page.goto('/fr/accept-invite?token=inconnu');
  await expect(page.getByText("Ce lien d'invitation n'est plus valable.")).toBeVisible();

  await page.goto('/fr/accept-invite');
  await expect(page.getByText("Ce lien d'invitation n'est plus valable.")).toBeVisible();
});
