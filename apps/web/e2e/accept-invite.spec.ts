import { test, expect } from '@playwright/test';

test('accept-invite avec token valide active le compte', async ({ page }) => {
  await page.goto('/fr/accept-invite?token=invite-ok');
  await page.getByLabel('Nouveau mot de passe').fill('motdepasse12');
  await page.getByRole('button', { name: 'Activer mon compte' }).click();
  await expect(page.getByRole('heading', { name: 'Bienvenue sur WABAGENT' })).toBeVisible();
});

test('accept-invite sans token affiche une erreur', async ({ page }) => {
  await page.goto('/fr/accept-invite');
  await expect(page.getByText('Invitation invalide ou expirée.')).toBeVisible();
});
