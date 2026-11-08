import { expect, type APIRequestContext, type Page } from '@playwright/test';

const MOCK_URL = 'http://localhost:4999';

export const PASSWORD = 'motdepasse12';

/** Remet le faux moteur dans son état initial (à appeler dans un `beforeEach`). */
export async function resetMock(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${MOCK_URL}/__reset`);
  expect(res.status()).toBe(204);
}

export async function login(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto('/fr/login');
  await page.getByLabel('Adresse e-mail').fill(email);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
}

/** Connexion puis attente de la liste des agents IA de l'organisation active. */
export async function loginToAgents(page: Page, email: string): Promise<void> {
  await login(page, email);
  await expect(page.getByRole('heading', { name: 'Tous les agents IA' })).toBeVisible();
}
