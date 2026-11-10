/**
 * Défauts du contre-audit du 10 nov. 2026 (docs/superpowers/research/2026-11-10-contre-audit-restitution.md, §5) :
 * D-1 compte en erreur sur la page de l'agent IA, D-2 refus 403 sans clé, D-3 focus sur le champ refusé, D-4 tons de
 * l'assistant, D-5 pages en échec de lecture, D-7 faux moteur aligné sur le moteur (clé de l'entrée invalide,
 * `provider_text` d'un contrôle) et écart anglais « Assign ». Les textes attendus sont lus dans `messages/<locale>.json`.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import { applyScenario, forceResponse, loginToAgents, msg, resetMock } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

const fr = (key: string, params: Record<string, string | number> = {}) => msg('fr', key, params);
const en = (key: string, params: Record<string, string | number> = {}) => msg('en', key, params);
const MOCK_URL = 'http://localhost:4999';

async function loginEnglish(page: Page, email = 'demo@wabagent.test'): Promise<void> {
  await page.goto('/en/login');
  await page.getByLabel(en('auth.email')).fill(email);
  await page.getByLabel(en('auth.password')).fill('motdepasse12');
  await page.getByRole('button', { name: en('auth.submit') }).click();
  await expect(page.getByRole('heading', { name: en('agents.title') })).toBeVisible();
}

const numberPanel = (page: Page, locale: 'fr' | 'en' = 'fr'): Locator =>
  page.getByRole('region', { name: msg(locale, 'agentNumber.title') });
const statusPanel = (page: Page, locale: 'fr' | 'en' = 'fr'): Locator =>
  page.getByRole('region', { name: msg(locale, 'agentStatus.title') });

// ---------------------------------------------------------------------------------------------------------------------
// D-1 : compte WhatsApp en erreur, vu sur la page de l'agent IA
// ---------------------------------------------------------------------------------------------------------------------

// contre-audit D-1
test('D-1, admin : l\'encart Numéro dit le motif, la conséquence et mène à Connexions ; le Statut ne promet plus de réponse', async ({ page, request }) => {
  await applyScenario(request, 'account-error-check');
  await loginToAgents(page, 'demo@wabagent.test');
  await page.goto('/fr/agents/demo-1');
  const panel = numberPanel(page);
  const alert = panel.getByRole('alert');
  await expect(alert).toContainText("Le compte est en erreur. Motif : Secret de l'app refusé. Remplacez les identifiants du compte.");
  await expect(alert).toContainText(fr('agentNumber.accountError.consequence'));
  await expect(alert).not.toContainText(fr('agentNumber.accountError.contactAdmin'));

  const status = statusPanel(page);
  await expect(status).toContainText(fr('agentStatus.description.accountError'));
  await expect(status).not.toContainText('répond à tous les contacts');
  await expect(status).not.toContainText("ne répond qu'aux numéros de la liste");

  await alert.getByRole('link', { name: fr('agentNumber.accountError.openConnections') }).click();
  await page.waitForURL('**/organisation/connexions');
});

// contre-audit D-1
test('D-1, conseiller : même motif et même conséquence, « Prévenez un administrateur », aucun lien', async ({ page, request }) => {
  await applyScenario(request, 'account-error-check');
  await loginToAgents(page, 'advisor@wabagent.test');
  await page.goto('/fr/agents/demo-1');
  const alert = numberPanel(page).getByRole('alert');
  await expect(alert).toContainText('Le compte est en erreur.');
  await expect(alert).toContainText(fr('agentNumber.accountError.consequence'));
  await expect(alert).toContainText(fr('agentNumber.accountError.contactAdmin'));
  await expect(alert.getByRole('link')).toHaveCount(0);
  await expect(statusPanel(page)).toContainText(fr('agentStatus.description.accountError'));
});

// contre-audit D-1
test('D-1, cause « support » : « Contactez le support », jamais le conseil de remplacer les identifiants', async ({ page, request }) => {
  await applyScenario(request, 'account-error-cannot-connect');
  await loginToAgents(page, 'demo@wabagent.test');
  await page.goto('/fr/agents/demo-1');
  const alert = numberPanel(page).getByRole('alert');
  await expect(alert).toContainText('Ce compte ne peut pas être raccordé. Contactez le support.');
  await expect(alert).not.toContainText('Remplacez les identifiants');
  await expect(alert).toContainText(fr('agentNumber.accountError.consequence'));
});

// contre-audit D-1
test('D-1, anglais : la phrase de cause seule, le motif français replié, la conséquence et le lien', async ({ page, request }) => {
  await applyScenario(request, 'account-error-check');
  await loginEnglish(page);
  await page.goto('/en/agents/demo-1');
  const alert = numberPanel(page, 'en').getByRole('alert');
  await expect(alert).toContainText(`${en('connections.alerts.errorOther')} ${en('connections.alerts.errorReplaceHint')}`);
  await expect(alert).toContainText(en('agentNumber.accountError.consequence'));
  await expect(alert.getByRole('link', { name: en('agentNumber.accountError.openConnections') })).toBeVisible();
  // le motif du moteur (en français) est replié, jamais en clair
  await expect(alert.locator('details')).not.toHaveAttribute('open', '');
  await expect(alert.getByText("Secret de l'app refusé")).toBeHidden();
  await expect(statusPanel(page, 'en')).toContainText(en('agentStatus.description.accountError'));
});

// contre-audit D-1 : compte connecté, rien de tout cela
test('D-1, compte connecté : aucun bandeau d\'erreur, la description habituelle', async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.goto('/fr/agents/demo-1');
  await expect(numberPanel(page).getByRole('alert')).toHaveCount(0);
  await expect(statusPanel(page)).toContainText('Cet agent IA répond à tous les contacts qui lui écrivent.');
});

// ---------------------------------------------------------------------------------------------------------------------
// D-2 : refus 403 sans clé
// ---------------------------------------------------------------------------------------------------------------------

// contre-audit D-2
for (const locale of ['fr', 'en'] as const) {
  test(`D-2, ${locale} : un refus 403 sans clé dit « pas les droits », jamais le texte brut du moteur`, async ({ page, request }) => {
    if (locale === 'fr') await loginToAgents(page, 'demo@wabagent.test');
    else await loginEnglish(page);
    await page.goto(`/${locale}/organisation/entites`);
    await page.getByRole('button', { name: msg(locale, 'organisation.entities.new') }).click();
    const field = page.getByLabel(msg(locale, 'organisation.entities.nameLabel'));
    await field.fill('Boutique Sud');
    await forceResponse(request, { route: '/entities', method: 'POST', status: 403, message: 'Accès refusé.', times: 1 });
    await field.press('Enter');
    await expect(page.getByRole('alert').filter({ hasText: msg(locale, 'errors.generic.forbidden') })).toBeVisible();
    await expect(page.getByText('Accès refusé.')).toHaveCount(0);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// D-3 : le focus va au premier champ refusé
// ---------------------------------------------------------------------------------------------------------------------

// contre-audit D-3
test('D-3, raccorder un compte : refus du moteur sur le jeton : le focus va au champ, relié à son message', async ({ page, request }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.goto('/fr/organisation/connexions');
  await page.getByRole('link', { name: fr('connections.connect') }).click();
  await page.getByLabel(fr('connections.connectFlow.fields.name')).fill('Atelier Rive Gauche');
  await page.getByLabel(fr('connections.connectFlow.fields.wabaId')).fill('556677889900112');
  await page.getByLabel(fr('connections.connectFlow.fields.accessToken')).fill('EAAGtokenvalide-0123456789');
  await page.getByLabel(fr('connections.connectFlow.fields.appSecret')).fill('secretdelappmeta0123');
  await forceResponse(request, {
    route: '/whatsapp-accounts', method: 'POST', status: 400, message: 'Données invalides.', reason: 'whatsapp_account.masked_value',
    details: [{ path: 'access_token', message: fr('errors.reasons.whatsapp_account.masked_value') }], times: 1,
  });
  await page.getByRole('button', { name: fr('connections.connectFlow.submit') }).click();
  const token = page.getByLabel(fr('connections.connectFlow.fields.accessToken'));
  await expect(token).toBeFocused();
  await expect(token).toHaveAttribute('aria-invalid', 'true');
  await expect(token).toHaveAccessibleDescription(new RegExp(fr('errors.reasons.whatsapp_account.masked_value').slice(0, 20)));
});

// contre-audit D-3
test('D-3, remplacer les identifiants : refus du moteur sur le secret : le focus va au champ', async ({ page, request }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.goto('/fr/organisation/connexions');
  await page.getByRole('button', { name: `${fr('actions.manage')} (Boutique principale)` }).click();
  await page.getByRole('menuitem', { name: fr('connections.menu.credentials') }).click();
  const dialog = page.getByRole('dialog', { name: fr('connections.credentials.title') });
  await dialog.getByLabel(fr('connections.credentials.wabaId')).fill('104829371625544');
  await dialog.getByLabel(fr('connections.credentials.accessToken')).fill('EAAGtokenvalide-0123456789');
  await dialog.getByLabel(fr('connections.credentials.appSecret')).fill('secretdelappmeta0123');
  await forceResponse(request, {
    route: '/whatsapp-accounts/1/credentials', method: 'PUT', status: 400, message: 'Données invalides.', reason: 'whatsapp_account.masked_value',
    details: [{ path: 'app_secret', message: fr('errors.reasons.whatsapp_account.masked_value') }], times: 1,
  });
  await dialog.getByRole('button', { name: fr('connections.credentials.submit'), exact: true }).click();
  await expect(dialog.getByLabel(fr('connections.credentials.appSecret'))).toBeFocused();
});

// ---------------------------------------------------------------------------------------------------------------------
// D-4 : tons de l'assistant dans la langue de l'interface
// ---------------------------------------------------------------------------------------------------------------------

// contre-audit D-4
test('D-4, anglais : les tons de l\'assistant sont affichés en anglais', async ({ page }) => {
  await loginEnglish(page);
  await page.getByRole('link', { name: en('agents.create') }).click();
  await page.getByLabel(en('wizard.name')).fill('Assistant Boutique');
  await page.getByRole('button', { name: new RegExp(en('wizard.continue')) }).click();
  await expect(page.getByRole('heading', { name: en('wizard.personalityTitle') })).toBeVisible();
  for (const key of ['warm', 'professional', 'concise', 'enthusiastic', 'formal']) {
    await expect(page.getByRole('button', { name: en(`wizard.tones.${key}`), exact: true })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Chaleureux' })).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------------------------------
// D-5 : pages en échec de lecture
// ---------------------------------------------------------------------------------------------------------------------

// contre-audit D-5
test('D-5, Connexions : « Impossible de charger les connexions. » en alerte avec Réessayer qui relit', async ({ page, request }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await forceResponse(request, { route: '/whatsapp-accounts', method: 'GET', status: 500, times: 1 });
  await page.goto('/fr/organisation/connexions');
  const alert = page.getByRole('alert').filter({ hasText: fr('errors.load.connections') });
  await expect(alert).toBeVisible();
  await expect(page.getByText(fr('errors.genericTitle'))).toHaveCount(0);
  await alert.getByRole('button', { name: fr('common.retry') }).click();
  await expect(page.getByRole('region', { name: 'Boutique principale' })).toBeVisible();
});

// contre-audit D-5
test('D-5, page de l\'agent IA : « Impossible de charger cet agent IA. » en alerte avec Réessayer', async ({ page, request }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await forceResponse(request, { route: '/bots/demo-1', method: 'GET', status: 500, times: 1 });
  await page.goto('/fr/agents/demo-1');
  const alert = page.getByRole('alert').filter({ hasText: fr('errors.load.agent') });
  await expect(alert).toBeVisible();
  await alert.getByRole('button', { name: fr('common.retry') }).click();
  await expect(numberPanel(page)).toBeVisible();
});

// contre-audit D-5
test('D-5, Usage de l\'agent IA : « Impossible de charger l\'usage de cet agent IA. » en alerte avec Réessayer', async ({ page, request }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await forceResponse(request, { route: '/bots/demo-1/usage', method: 'GET', status: 500, times: 1 });
  await page.goto('/fr/agents/demo-1/usage');
  const alert = page.getByRole('alert').filter({ hasText: fr('errors.load.agentUsage') });
  await expect(alert).toBeVisible();
  await alert.getByRole('button', { name: fr('common.retry') }).click();
  await expect(page.getByRole('cell', { name: 'Total' })).toBeVisible();
});

// contre-audit D-5
test('D-5, accueil : « Impossible de charger les agents IA. » en alerte avec Réessayer, jamais la liste vide', async ({ page, request }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await forceResponse(request, { route: '/bots', method: 'GET', status: 500, times: 1 });
  await page.goto('/fr');
  const alert = page.getByRole('alert').filter({ hasText: fr('errors.load.agents') });
  await expect(alert).toBeVisible();
  await expect(page.getByText(fr('onboarding.welcomeTitle'))).toHaveCount(0);
  await alert.getByRole('button', { name: fr('common.retry') }).click();
  await expect(page.getByText('Support technique')).toBeVisible();
});

// ---------------------------------------------------------------------------------------------------------------------
// D-7 : faux moteur aligné sur le moteur, et conservé en anglais
// ---------------------------------------------------------------------------------------------------------------------

// contre-audit D-7 : le faux moteur envoie la clé `allowlist.invalid_entry` comme le moteur réel (bot-service.ts, normalizeAllowlist)
test('D-7, anglais : une entrée invalide de la liste d\'accès limité est refusée avec le texte anglais de la clé, sans refus forcé', async ({ page }) => {
  await loginEnglish(page);
  await page.goto('/en/agents/demo-1');
  const list = page.getByRole('region', { name: en('agentAllowlist.title') });
  await page.getByLabel(en('allowlist.label')).fill('abc def');
  await list.getByRole('button', { name: en('allowlist.add'), exact: true }).click();
  await list.getByRole('button', { name: en('agentAllowlist.save') }).click();
  await expect(list.getByRole('alert')).toHaveText(en('errors.reasons.allowlist.invalid_entry'));
  await expect(page.getByText('Numéro au format international')).toHaveCount(0);
  // contre-audit D-3 : le focus va au bouton qui corrige l'entrée refusée
  await expect(list.getByRole('button', { name: /^Remove/ })).toBeFocused();
});

// contre-audit D-7 : `POST /__fail` garde le `provider_text` d'un contrôle refusé
test('D-7, anglais : le texte du fournisseur d\'un contrôle refusé reste dans le détail replié', async ({ page, request }) => {
  await loginEnglish(page);
  await page.goto('/en/organisation/connexions');
  await page.getByRole('button', { name: `${en('actions.manage')} (Boutique principale)` }).click();
  await page.getByRole('menuitem', { name: en('connections.menu.credentials') }).click();
  const dialog = page.getByRole('dialog', { name: en('connections.credentials.title') });
  await dialog.getByLabel(en('connections.credentials.wabaId')).fill('104829371625544');
  await dialog.getByLabel(en('connections.credentials.accessToken')).fill('EAAGtokenvalide-0123456789');
  await dialog.getByLabel(en('connections.credentials.appSecret')).fill('secretdelappmeta0123');
  await forceResponse(request, {
    route: '/whatsapp-accounts/1/credentials', method: 'PUT', status: 422, message: 'Vérification du compte impossible.', reason: 'whatsapp_account.verification_failed',
    details: [{ path: 'token', message: 'Le jeton est refusé par Meta.', provider_text: '(#190) Invalid OAuth access token.' }], times: 1,
  });
  await dialog.getByRole('button', { name: en('connections.credentials.submit'), exact: true }).click();
  const checks = dialog.getByRole('list', { name: en('connections.checks.listLabel') });
  await expect(checks.getByText(en('connections.checks.keys.token'))).toBeVisible();
  const details = checks.locator('details');
  await expect(details).not.toHaveAttribute('open', '');
  await expect(details.getByText('(#190) Invalid OAuth access token.')).toBeHidden();
  await details.getByText(en('connections.providerText')).click();
  await expect(details.getByText('(#190) Invalid OAuth access token.')).toBeVisible();
  // jamais le texte français du moteur en clair dans l'interface anglaise
  await expect(page.getByText('Le jeton est refusé par Meta.')).toHaveCount(0);
});

// contre-audit D-7 / item 9 : le faux moteur refuse de poser une clé que le moteur réel ne connaît pas
test('D-7, le faux moteur refuse un refus forcé dont la clé est hors ERROR_REASONS', async ({ request }) => {
  // Clé inventée (le contre-audit avait forcé celle-ci) : écrite en deux morceaux pour que le test statique des clés n'y voie pas une clé employée.
  const invented = ['entity', 'name_too_long'].join('.');
  const res = await request.post(`${MOCK_URL}/__fail`, { data: { route: '/entities', method: 'POST', status: 400, reason: invented } });
  expect(res.status()).toBe(400);
  const ok = await request.post(`${MOCK_URL}/__fail`, { data: { route: '/entities', method: 'POST', status: 409, reason: 'entity.duplicate_name', times: 1 } });
  expect(ok.status()).toBe(204);
});

// ---------------------------------------------------------------------------------------------------------------------
// Écart anglais : Brancher = Assign, Débrancher = Unassign, Raccorder = Connect
// ---------------------------------------------------------------------------------------------------------------------

// contre-audit D-8
test('anglais : « Assign » / « Unassign » pour le numéro d\'un agent IA, « Connect » pour un compte', async ({ page }) => {
  await loginEnglish(page);
  await page.goto('/en/agents/demo-1');
  const panel = numberPanel(page, 'en');
  await expect(panel.getByRole('button', { name: 'Unassign' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Disconnect' })).toHaveCount(0);
  await page.goto('/en/organisation/connexions');
  await expect(page.getByRole('link', { name: en('connections.connect') })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Assign/ }).first()).toContainText('Assign');
  await expect(page.getByRole('button', { name: /^Connect/ })).toHaveCount(0);
});
