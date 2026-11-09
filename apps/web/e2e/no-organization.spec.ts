import { test, expect } from '@playwright/test';
import { login, resetMock } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

test('compte sans organisation accessible : page « aucune organisation », Mon compte accessible', async ({ page }) => {
  // seule organisation suspendue (Studio Ocre) : /auth/me la liste avec status: 'suspended', aucune n'est ouvrable
  await login(page, 'suspendu@wabagent.test');
  await expect(page).toHaveURL(/\/fr\/no-organization$/);
  await expect(page.getByRole('heading', { name: 'Aucune organisation' })).toBeVisible();
  // audit R-13 : la page dit la suspension, nomme l'organisation, ne parle pas d'invitation
  await expect(
    page.getByText("Studio Ocre est suspendue. Contactez l'administrateur de votre organisation ou le support."),
  ).toBeVisible();
  await expect(page.getByText('invitation')).toHaveCount(0);

  // l'app (liste des agents IA) renvoie sur la même page, sans boucle
  await page.goto('/fr');
  await expect(page).toHaveURL(/\/fr\/no-organization$/);

  await page.getByRole('link', { name: 'Mon compte' }).click();
  await expect(page).toHaveURL(/\/fr\/account\/preferences$/);
  await expect(page.getByRole('heading', { name: 'Préférences' })).toBeVisible();
  await page.getByRole('link', { name: 'Sécurité' }).click();
  await expect(page.getByLabel('Mot de passe actuel')).toBeVisible();

  await page.goto('/fr/no-organization');
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page).toHaveURL(/\/fr\/login$/);
});

// audit R-13 : sans aucune appartenance, le texte général (invitation) reste
test('compte sans aucune appartenance : texte général, invitation comprise', async ({ page }) => {
  await login(page, 'suspendu@wabagent.test');
  await expect(page).toHaveURL(/\/fr\/no-organization$/);
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ json: { user: { id: 3, email: 'suspendu@wabagent.test', role: 'client_admin', status: 'active', organizations: [] }, active_client_id: null } }),
  );
  await page.reload();
  await expect(page.getByText("Vous n'avez accès à aucune organisation pour le moment.", { exact: false })).toBeVisible();
  await expect(page.getByText('Si vous attendez une invitation', { exact: false })).toBeVisible();
});
