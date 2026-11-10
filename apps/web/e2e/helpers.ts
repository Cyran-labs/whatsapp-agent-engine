import { expect, type APIRequestContext, type Page } from '@playwright/test';

const MOCK_URL = 'http://localhost:4999';

export const PASSWORD = 'motdepasse12';

/** Remet le faux moteur dans son état initial (à appeler dans un `beforeEach`). */
export async function resetMock(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${MOCK_URL}/__reset`);
  expect(res.status()).toBe(204);
}

/** Force une route du faux moteur à répondre `status` (panne) jusqu'au prochain `resetMock`. Ex. : `/auth/login`. */
export async function failRoute(request: APIRequestContext, route: string, status: number): Promise<void> {
  const res = await request.post(`${MOCK_URL}/__fail`, { data: { route, status } });
  expect(res.status()).toBe(204);
}

/** Force le refus métier de la création d'un agent IA (`POST /bots`) jusqu'au prochain `resetMock`. */
export async function refuseCreation(request: APIRequestContext, reason: 'bot.entity_required' | 'bot.default_language_missing'): Promise<void> {
  const res = await request.post(`${MOCK_URL}/__refuse`, { data: { route: '/bots', reason } });
  expect(res.status()).toBe(204);
}

/** Prépare un état du faux moteur (voir `/__scenario`) jusqu'au prochain `resetMock`. */
export async function applyScenario(
  request: APIRequestContext,
  name: 'account-error-check' | 'account-error-provider-text' | 'account-error-cannot-connect' | 'delivery-failures',
): Promise<void> {
  const res = await request.post(`${MOCK_URL}/__scenario`, { data: { name } });
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

/** Dernier lien de réinitialisation « envoyé » par le faux moteur (chemin relatif, sans locale), ou null. */
export async function lastResetLink(request: APIRequestContext): Promise<string | null> {
  const res = await request.get(`${MOCK_URL}/__last-reset-link`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { link: string | null }).link;
}
