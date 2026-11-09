import { test, expect, type Page } from '@playwright/test';
import { loginToAgents, resetMock } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

const RAIL = (page: Page) => page.getByRole('complementary');
const CONNECTIONS_LINK = (page: Page) => RAIL(page).getByRole('link', { name: /^Connexions/ });

/** Connexion en administrateur de Maison Lumière, puis ouverture de Connexions par le rail de l'organisation. */
async function openConnections(page: Page): Promise<void> {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.getByRole('banner').getByRole('link', { name: 'Organisation' }).click();
  await CONNECTIONS_LINK(page).click();
  await expect(page.getByRole('heading', { name: 'Connexions', level: 1 })).toBeVisible();
}

/** Ligne du tableau de numéros dont la cellule « Numéro » commence par ce numéro affiché. */
const numberRow = (page: Page, shown: string) => page.getByRole('row', { name: new RegExp(`^${shown.replace('+', '\\+')}`) });

test('un administrateur ouvre Connexions : le compte, ses trois numéros, leur branchement et le bandeau du numéro de test', async ({ page }) => {
  await openConnections(page);

  // le compteur du rail compte les comptes WhatsApp non déconnectés
  await expect(CONNECTIONS_LINK(page)).toHaveAccessibleName('Connexions 1');
  await expect(CONNECTIONS_LINK(page)).toHaveAttribute('aria-current', 'page');

  const account = page.getByRole('region', { name: 'Boutique principale' });
  await expect(account.getByText('API Meta directe · raccordement manuel')).toBeVisible();
  await expect(account.locator('header').getByText('Connecté', { exact: true })).toBeVisible();

  // trois numéros, en entier (écran d'administration), et rien de l'autre organisation
  await expect(account.getByRole('row')).toHaveCount(4);
  const branded = numberRow(page, '+33 1 84 80 12 34');
  await expect(branded.getByRole('link', { name: /Support technique/ })).toBeVisible();
  await expect(branded.getByText('Actif', { exact: true })).toBeVisible();
  const free = numberRow(page, '+33 6 12 45 78 90');
  await expect(free.getByText('Libre', { exact: true })).toBeVisible();
  await expect(free.getByRole('button', { name: 'Brancher sur un agent IA' })).toBeVisible();
  // le numéro de test porte sa pastille (en plus de son nom d'affichage) et propose de retirer le marquage
  const testNumber = numberRow(page, '+1 555 164 9072');
  await expect(testNumber.getByText('Numéro de test', { exact: true })).toHaveCount(2);
  await testNumber.getByRole('button', { name: 'Actions du numéro +1 555 164 9072' }).click();
  await expect(page.getByRole('menuitem', { name: "Ce n'est pas un numéro de test" })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('+33 9 55 50 01 23')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Atelier Nord' })).toHaveCount(0);

  // bandeau du numéro de test, avec son lien vers l'app Meta
  await expect(account.getByText('Numéro de test Meta :')).toBeVisible();
  await expect(account.getByRole('link', { name: 'Gérer les destinataires dans Meta ↗' })).toBeVisible();

  // webhook du compte : adresse en clair, jeton masqué puis affiché
  await expect(account.getByText('https://dev.wabagent.com/webhook/meta/cle-demo')).toBeVisible();
  await expect(account.getByText('••••1234')).toBeVisible();
  await expect(account.getByText('vt-demo-1234')).toHaveCount(0);
  await account.getByRole('button', { name: 'Afficher' }).click();
  await expect(account.getByText('vt-demo-1234')).toBeVisible();
});

test("raccorder un second compte Meta : échec 422 affiché, puis succès, le compteur du rail passe à 2", async ({ page }) => {
  await openConnections(page);
  await page.getByRole('link', { name: '+ Raccorder un compte WhatsApp' }).click();
  await expect(page.getByRole('heading', { name: 'Raccorder un compte WhatsApp', level: 1 })).toBeVisible();

  await page.getByLabel('Nom du compte dans WABAGENT').fill('Atelier Rive Gauche');
  await page.getByLabel('ID du compte WhatsApp Business (WABA)').fill('000000');
  await page.getByLabel("Jeton d'accès").fill('EAAGtokenvalide-0123456789');
  await page.getByLabel("Secret de l'app").fill('secretdelappmeta0123');
  await page.getByRole('button', { name: 'Vérifier et raccorder' }).click();

  // le refus du moteur s'affiche avec ses contrôles en échec, rien n'est enregistré
  await expect(page.getByRole('alert').filter({ hasText: 'Vérification du compte impossible.' })).toBeVisible();
  const checks = page.getByRole('list', { name: 'Contrôles de vérification' });
  await expect(checks.getByText('Accès au compte WhatsApp Business')).toBeVisible();
  await expect(checks.getByText('Ce WABA ID est introuvable ou inaccessible avec ce jeton.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Compte raccordé' })).toHaveCount(0);

  // WABA corrigé : le compte est raccordé, ses numéros et son webhook s'affichent
  await page.getByLabel('ID du compte WhatsApp Business (WABA)').fill('556677889900112');
  await page.getByRole('button', { name: 'Vérifier et raccorder' }).click();
  await expect(page.getByRole('heading', { name: 'Compte raccordé' })).toBeVisible();
  await expect(page.getByText('1 numéro trouvé')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Numéros trouvés' }).getByText('Atelier Rive Gauche')).toBeVisible();
  await expect(page.getByText('Dernière étape chez Meta')).toBeVisible();
  await expect(page.getByText('https://dev.wabagent.com/webhook/meta/')).toBeVisible();

  // retour à Connexions : deux comptes, compteur du rail à 2
  await page.getByRole('link', { name: 'Terminer' }).click();
  await expect(page.getByRole('heading', { name: 'Connexions', level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Atelier Rive Gauche' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Boutique principale' })).toBeVisible();
  await expect(CONNECTIONS_LINK(page)).toHaveAccessibleName('Connexions 2');
});

test("brancher le numéro libre sur un agent IA brouillon de l'organisation, sans proposer celui d'une autre", async ({ page }) => {
  await openConnections(page);
  const free = numberRow(page, '+33 6 12 45 78 90');
  await free.getByRole('button', { name: 'Brancher sur un agent IA' }).click();

  const dialog = page.getByRole('dialog', { name: 'Brancher le numéro sur un agent IA' });
  await expect(dialog.getByText('Choisissez l\'agent IA de l\'organisation qui répondra sur le numéro +33 6 12 45 78 90.')).toBeVisible();
  // seuls les agents IA de Maison Lumière sont proposés
  await expect(dialog.getByRole('radio')).toHaveCount(2);
  await expect(dialog.getByRole('radio', { name: /Assistant atelier/ })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Brancher', exact: true })).toBeDisabled();
  await expect(dialog.getByText('Choisissez un agent IA pour brancher le numéro.')).toBeVisible();

  await dialog.getByRole('radio', { name: /Accueil boutique/ }).check();
  await dialog.getByRole('button', { name: 'Brancher', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  // l'état final se lit dans la ligne : agent IA branché, plus « Libre »
  await expect(free.getByRole('link', { name: /Accueil boutique/ })).toBeVisible();
  await expect(free.getByText('Brouillon', { exact: true })).toBeVisible();
  await expect(free.getByText('Libre', { exact: true })).toHaveCount(0);

  // et sur la page de l'agent IA : le numéro est branché, il reste en brouillon
  await free.getByRole('link', { name: /Accueil boutique/ }).click();
  await expect(page.getByRole('heading', { name: 'Numéro WhatsApp' })).toBeVisible();
  await expect(page.getByText('+33 6 12 45 78 90')).toBeVisible();
  await expect(page.getByText('Compte Boutique principale')).toBeVisible();
});

test("déconnecter le compte tenu par un agent IA actif : le refus nomme l'agent IA, rien ne change", async ({ page }) => {
  await openConnections(page);
  await page.getByRole('button', { name: 'Actions du compte Boutique principale' }).click();
  await page.getByRole('menuitem', { name: 'Déconnecter' }).click();

  const dialog = page.getByRole('dialog', { name: 'Déconnecter Boutique principale ?' });
  await dialog.getByRole('button', { name: 'Déconnecter le compte' }).click();

  await expect(dialog.getByRole('alert')).toHaveText("Mettez d'abord en pause ou en brouillon les agents IA qui utilisent ce compte.");
  await expect(dialog.getByRole('list', { name: 'Agents IA qui utilisent ce compte' }).getByRole('listitem')).toHaveText(['Support technique']);

  // la fenêtre se ferme, le compte est inchangé : connecté, ses numéros et son compteur
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await expect(dialog).toHaveCount(0);
  const account = page.getByRole('region', { name: 'Boutique principale' });
  await expect(account.locator('header').getByText('Connecté', { exact: true })).toBeVisible();
  await expect(account.getByRole('row')).toHaveCount(4);
  await expect(CONNECTIONS_LINK(page)).toHaveAccessibleName('Connexions 1');
  await expect(page.getByText(/compte déconnecté/)).toHaveCount(0);
});

test('un compte sans agent IA en service se déconnecte : il quitte la liste et le compteur du rail', async ({ page }) => {
  await openConnections(page);
  // l'agent IA actif est d'abord remis en brouillon depuis sa page, puis on revient à Connexions
  await numberRow(page, '+33 1 84 80 12 34').getByRole('link', { name: /Support technique/ }).click();
  await page.getByRole('button', { name: 'Revenir en brouillon' }).click();
  await expect(page.getByText('Cet agent IA ne répond à personne.')).toBeVisible();
  await page.goto('/fr/organisation/connexions');
  await expect(numberRow(page, '+33 1 84 80 12 34').getByText('Brouillon', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Actions du compte Boutique principale' }).click();
  await page.getByRole('menuitem', { name: 'Déconnecter' }).click();
  await page.getByRole('dialog', { name: 'Déconnecter Boutique principale ?' }).getByRole('button', { name: 'Déconnecter le compte' }).click();

  await expect(page.getByRole('heading', { name: 'Aucun compte WhatsApp raccordé' })).toBeVisible();
  await expect(CONNECTIONS_LINK(page)).toHaveAccessibleName('Connexions 0');
  await expect(page.getByText('1 compte déconnecté')).toBeVisible();
});

test("un conseiller qui ouvre l'adresse de Connexions est renvoyé à l'accueil", async ({ page }) => {
  await loginToAgents(page, 'advisor@wabagent.test');
  await page.goto('/fr/organisation/connexions');

  await expect(page).toHaveURL(/\/fr\/?$/);
  await expect(page.getByRole('heading', { name: 'Tous les agents IA' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Connexions', level: 1 })).toHaveCount(0);
  await expect(page.getByRole('banner').getByRole('link', { name: 'Organisation' })).toHaveCount(0);
});
