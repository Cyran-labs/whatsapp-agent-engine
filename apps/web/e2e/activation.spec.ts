import { test, expect, type Page } from '@playwright/test';
import { loginToAgents, resetMock } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

const LIMITED_NUMBER = '+33 6 12 45 78 90';
const TEST_NUMBER = '+1 555 164 9072';

/** Connexion en administrateur, puis assistant de création jusqu'à l'étape 4 « Numéro » (agent IA créé en brouillon). */
async function createAgentUpToNumberStep(page: Page, name: string): Promise<void> {
  await page.getByRole('link', { name: '+ Créer un agent IA' }).click();
  await page.getByLabel("Nom de l'agent IA").fill(name);
  await page.getByRole('button', { name: /Continuer/ }).click();
  await page.getByLabel('Rôle / métier').fill('Conseiller commercial');
  await page.getByRole('button', { name: /Créer & tester/ }).click();
  await expect(page.getByRole('heading', { name: 'Discutez avec votre agent IA' })).toBeVisible();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByRole('heading', { name: 'Sur quel numéro répond-il ?' })).toBeVisible();
}

test("assistant jusqu'à l'activation en accès limité, puis ouverture à tous depuis la page de l'agent IA", async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await createAgentUpToNumberStep(page, 'Assistant Boutique');

  // étape 4 : les numéros de l'organisation seulement ; Continuer attend un choix et dit pourquoi
  const picker = page.getByRole('radiogroup', { name: 'Numéros WhatsApp de l\'organisation' });
  await expect(picker.getByRole('radio')).toHaveCount(3);
  await expect(picker.getByText('Utilisé par Support technique')).toBeVisible();
  await expect(page.getByText('+33 9 55 50 01 23')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continuer' })).toBeDisabled();
  await expect(page.getByText('Choisissez un numéro pour continuer.')).toBeVisible();
  await picker.getByRole('radio', { name: new RegExp(LIMITED_NUMBER.replace('+', '\\+')) }).check({ force: true });
  await page.getByRole('button', { name: 'Continuer' }).click();

  // étape 5 : récapitulatif et contrôles, activation bloquée tant que la liste d'accès limité est vide
  await expect(page.getByRole('heading', { name: 'Prêt à répondre à vos clients' })).toBeVisible();
  const recap = page.getByRole('list', { name: 'Récapitulatif' });
  await expect(recap.getByText('Assistant Boutique')).toBeVisible();
  await expect(recap.getByText(LIMITED_NUMBER)).toBeVisible();
  await expect(recap.getByText('Draft', { exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Contrôles avant activation' }).getByText('Numéro libre, il sera branché sur cet agent IA.')).toBeVisible();
  const activate = page.getByRole('button', { name: 'Activer en accès limité' });
  await expect(activate).toBeDisabled();
  await expect(page.getByText('Ajoutez au moins un numéro à la Whitelist pour activer.')).toBeVisible();

  await page.getByLabel('Numéro à autoriser').fill('+33611223344');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Numéros autorisés' }).getByText('+33 6 11 22 33 44')).toBeVisible();
  await expect(activate).toBeEnabled();
  await activate.click();

  // confirmation : agent IA en ligne en accès limité sur le numéro choisi, QR code et lien wa.me
  await expect(page.getByRole('heading', { name: 'Assistant Boutique est en ligne' })).toBeVisible();
  await expect(page.getByText('Preview', { exact: true })).toBeVisible();
  await expect(page.getByText(LIMITED_NUMBER)).toBeVisible();
  await expect(page.getByText("Pour l'instant, seuls les numéros de la liste d'accès limité reçoivent une réponse.")).toBeVisible();
  const qr = page.getByRole('img', { name: 'QR code pour écrire à Assistant Boutique sur WhatsApp' });
  await expect(qr).toBeVisible();
  await expect(qr).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(page.getByRole('link', { name: 'wa.me/33612457890' })).toHaveAttribute('href', 'https://wa.me/33612457890');

  // page de l'agent IA : statut Preview, numéro branché, Whitelist enregistrée
  await page.getByRole('link', { name: "Ouvrir l'agent IA" }).click();
  const status = page.getByRole('region', { name: 'Statut' });
  await expect(status.getByText('Preview', { exact: true })).toBeVisible();
  await expect(status.getByText('Répond seulement aux numéros de la Whitelist.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Numéro WhatsApp' }).getByText(LIMITED_NUMBER)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Whitelist' }).getByText('+33 6 11 22 33 44')).toBeVisible();

  // ouvrir à tous : statut « Ouvert à tous »
  await status.getByRole('button', { name: 'Passer Online' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Passer Online' }).click();
  await expect(status.getByText('Online', { exact: true })).toBeVisible();
  await expect(status.getByText('Répond à tous les contacts qui lui écrivent.')).toBeVisible();
  await expect(status.getByRole('button', { name: 'Passer Online' })).toHaveCount(0);

  // la liste des agents IA reprend la pastille mise à jour
  await page.getByRole('navigation', { name: "Fil d'Ariane" }).getByRole('link', { name: 'Agents IA' }).click();
  await expect(page.getByRole('heading', { name: 'Agents IA', exact: true })).toBeVisible();
  const row = page.getByRole('row', { name: /Assistant Boutique/ });
  await expect(row.getByText('Online', { exact: true })).toBeVisible();
  await expect(row.getByText('Preview', { exact: true })).toHaveCount(0);
  // l'agent IA déjà en service sur un autre numéro n'a pas bougé
  await expect(page.getByRole('row', { name: /Support technique/ }).getByText('Online', { exact: true })).toBeVisible();
});

test("assistant sur le numéro de test : « Activer » ouvre directement à tous, sans liste d'accès limité", async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await createAgentUpToNumberStep(page, 'Assistant Essai');

  const picker = page.getByRole('radiogroup', { name: 'Numéros WhatsApp de l\'organisation' });
  await picker.getByRole('radio', { name: new RegExp(TEST_NUMBER.replace('+', '\\+')) }).check({ force: true });
  await expect(page.getByText('Numéro de test Meta : seuls les destinataires déclarés dans votre app Meta (5 au plus) pourront lui écrire.')).toBeVisible();
  await page.getByRole('button', { name: 'Continuer' }).click();

  await expect(page.getByRole('heading', { name: 'Prêt à répondre à vos clients' })).toBeVisible();
  await expect(page.getByText('Dès l\'activation, les messages reçus sur ce numéro de test sont traités par l\'agent IA.')).toBeVisible();
  // liste facultative : aucune raison de blocage, le bouton s'appelle « Activer »
  await expect(page.getByRole('button', { name: 'Activer en accès limité' })).toHaveCount(0);
  const activate = page.getByRole('button', { name: 'Activer', exact: true });
  await expect(activate).toBeEnabled();
  await activate.click();

  await expect(page.getByRole('heading', { name: 'Assistant Essai est en ligne' })).toBeVisible();
  await expect(page.getByText('Online', { exact: true })).toBeVisible();
  await expect(page.getByText(TEST_NUMBER)).toBeVisible();
  await expect(page.getByText("Pour l'instant, seuls les numéros de la liste d'accès limité reçoivent une réponse.")).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'wa.me/15551649072' })).toHaveAttribute('href', 'https://wa.me/15551649072');

  // la page de l'agent IA confirme : actif, numéro de test branché
  await page.getByRole('link', { name: "Ouvrir l'agent IA" }).click();
  await expect(page.getByRole('region', { name: 'Statut' }).getByText('Online', { exact: true })).toBeVisible();
  const number = page.getByRole('region', { name: 'Numéro WhatsApp' });
  await expect(number.getByText(TEST_NUMBER)).toBeVisible();
  await expect(number.getByText('Numéro de test', { exact: true })).toBeVisible();
});

test("« Plus tard » à l'étape Numéro termine l'assistant : l'agent IA reste en brouillon, sans numéro", async ({ page }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await createAgentUpToNumberStep(page, 'Assistant Plus Tard');

  await page.getByRole('button', { name: 'Plus tard' }).click();
  await expect(page.getByRole('heading', { name: 'Votre agent IA est prêt' })).toBeVisible();
  await expect(page.getByText('« Assistant Plus Tard » est créé en brouillon.')).toBeVisible();
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /est en ligne/ })).toHaveCount(0);

  // aucun numéro n'a été pris : la liste montre l'agent IA en brouillon, sans numéro, et les trois numéros restent libres
  await page.getByRole('button', { name: 'Retour aux agents IA' }).click();
  const row = page.getByRole('row', { name: /Assistant Plus Tard/ });
  await expect(row.getByText('Draft', { exact: true })).toBeVisible();
  await expect(row.getByText('Aucun numéro')).toBeVisible();
  await page.goto('/fr/organisation/connexions');
  await expect(page.getByRole('row', { name: new RegExp(`^${LIMITED_NUMBER.replace('+', '\\+')}`) }).getByText('Libre', { exact: true })).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(`^${TEST_NUMBER.replace('+', '\\+')}`) }).getByText('Libre', { exact: true })).toBeVisible();
});
