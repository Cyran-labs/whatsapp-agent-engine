import { test, expect, type Page } from '@playwright/test';
import { applyScenario, forceResponse, loginToAgents, rail, resetMock } from './helpers';
import { ACCEPTED_PIN, META_BUSINESS, MOCK_PHOTO_HOST } from './mock-state';

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

const RAIL = (page: Page) => page.getByRole('complementary');
const NOT_CONNECTED = "Le compte WhatsApp de ce numéro n'est pas connecté.";
const CONNECTIONS_LINK = (page: Page) => RAIL(page).getByRole('link', { name: /^Connexions/ });

/** Connexion en administrateur de Maison Lumière, puis ouverture de Connexions par le rail de l'organisation. */
async function openConnections(page: Page): Promise<void> {
  await loginToAgents(page, 'demo@wabagent.test');
  await rail(page).getByRole('link', { name: 'Organisation' }).click();
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
  await expect(branded.getByText('Online', { exact: true })).toBeVisible();
  const free = numberRow(page, '+33 6 12 45 78 90');
  await expect(free.getByText('Libre', { exact: true })).toBeVisible();
  await expect(free.getByRole('button', { name: 'Brancher sur un agent IA' })).toBeVisible();
  // le numéro de test porte sa pastille (en plus de son nom d'affichage) et propose de retirer le marquage
  const testNumber = numberRow(page, '+1 555 164 9072');
  await expect(testNumber.getByText('Numéro de test', { exact: true })).toHaveCount(2);
  await testNumber.getByRole('button', { name: 'Gérer (+1 555 164 9072)' }).click();
  await expect(page.getByRole('menuitem', { name: "Ce n'est pas un numéro de test" })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('+33 9 55 50 01 23')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Atelier Nord' })).toHaveCount(0);

  // bandeau du numéro de test, avec son lien vers l'app Meta
  await expect(account.getByText('Numéro de test Meta :')).toBeVisible();
  await expect(account.getByRole('link', { name: 'Gérer les destinataires dans Meta ↗' })).toBeVisible();

  // lot R1 (spec R1 §6.2) : compte Meta, WABAGENT a inscrit lui-même le webhook ; l'état lu chez Meta remplace la boîte
  // à recopier (ni adresse, ni jeton de vérification, ni bouton « Afficher »)
  const webhooks = account.getByRole('group', { name: 'Webhooks et état du compte chez Meta' });
  await expect(webhooks.getByText('Webhook inscrit chez Meta.')).toBeVisible();
  await expect(account.getByText(/\/webhook\/meta\//)).toHaveCount(0);
  await expect(account.getByText(/vt-demo|••••/)).toHaveCount(0);
  await expect(account.getByRole('button', { name: 'Afficher' })).toHaveCount(0);
});

test("raccorder un second compte Meta : échec 422 affiché, puis succès, le compteur du rail passe à 2", async ({ page }) => {
  await openConnections(page);
  await page.getByRole('link', { name: 'Raccorder un compte WhatsApp', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Raccorder un compte WhatsApp', level: 1 })).toBeVisible();

  await page.getByLabel("Adresse d'une page Meta Business ou ID du portefeuille").fill('1270659448489249');
  await page.getByText("J'ai déjà un compte WhatsApp Business").click();
  await page.getByLabel('Nom du compte dans WABAGENT').fill('Atelier Rive Gauche');
  await page.getByLabel('ID du compte WhatsApp Business (WABA)').fill('000000');
  await page.getByLabel("Jeton d'accès").fill('EAAGtokenvalide-0123456789');
  await page.getByLabel("Secret de l'app").fill('secretdelappmeta0123');
  await page.getByRole('button', { name: 'Vérifier et raccorder' }).click();

  // le refus du moteur s'affiche avec ses contrôles en échec, rien n'est enregistré
  await expect(page.getByRole('alert').filter({ hasText: 'Vérification du compte impossible.' })).toBeVisible();
  const checks = page.getByRole('list', { name: 'Contrôles de vérification' });
  await expect(checks.getByText('Compte WhatsApp (WABA)')).toBeVisible();
  await expect(checks.getByText('Ce WABA ID est introuvable ou inaccessible avec ce jeton.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Compte raccordé' })).toHaveCount(0);

  // WABA corrigé : le compte est raccordé et ses numéros s'affichent ; lot R1 : aucune étape webhook à faire chez Meta
  await page.getByLabel('ID du compte WhatsApp Business (WABA)').fill('556677889900112');
  await page.getByRole('button', { name: 'Vérifier et raccorder' }).click();
  await expect(page.getByRole('heading', { name: 'Compte raccordé' })).toBeVisible();
  await expect(page.getByText('1 numéro trouvé')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Numéros trouvés' }).getByText('Atelier Rive Gauche')).toBeVisible();
  await expect(page.getByText('Dernière étape chez Meta')).toHaveCount(0);
  await expect(page.getByText(/\/webhook\/meta\//)).toHaveCount(0);

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
  await expect(free.getByText('Draft', { exact: true })).toBeVisible();
  await expect(free.getByText('Libre', { exact: true })).toHaveCount(0);

  // et sur la page de l'agent IA : le numéro est branché, il reste en brouillon
  await free.getByRole('link', { name: /Accueil boutique/ }).click();
  await expect(page.getByRole('heading', { name: 'Numéro WhatsApp' })).toBeVisible();
  await expect(page.getByText('+33 6 12 45 78 90')).toBeVisible();
  await expect(page.getByText('Compte WhatsApp : Boutique principale')).toBeVisible();
});

test("retirer le compte tenu par un agent IA en service : le refus nomme l'agent IA, rien ne change", async ({ page }) => {
  await openConnections(page);
  // recette Q-6 : le menu est un bouton visible « Gérer ▾ »
  await expect(page.getByRole('region', { name: 'Boutique principale' }).locator('header').getByRole('button', { name: 'Gérer (Boutique principale)' })).toHaveText(/Gérer/);
  await page.getByRole('button', { name: 'Gérer (Boutique principale)' }).click();
  await page.getByRole('menuitem', { name: 'Retirer le compte' }).click();

  const dialog = page.getByRole('dialog', { name: 'Retirer le compte Boutique principale ?' });
  await dialog.getByRole('button', { name: 'Retirer le compte' }).click();

  await expect(dialog.getByRole('alert')).toHaveText("Mettez d'abord Offline les agents IA qui utilisent ce compte :");
  await expect(dialog.getByRole('list', { name: 'Agents IA qui utilisent ce compte' }).getByRole('listitem')).toHaveText(['Support technique']);

  // la fenêtre se ferme, le compte est inchangé : connecté, ses numéros et son compteur
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await expect(dialog).toHaveCount(0);
  const account = page.getByRole('region', { name: 'Boutique principale' });
  await expect(account.locator('header').getByText('Connecté', { exact: true })).toBeVisible();
  await expect(account.getByRole('row')).toHaveCount(4);
  await expect(CONNECTIONS_LINK(page)).toHaveAccessibleName('Connexions 1');
  await expect(page.getByText(/compte retiré/)).toHaveCount(0);
});

test('un compte sans agent IA en service est retiré : réussite notifiée, il quitte la liste et le compteur du rail', async ({ page }) => {
  await openConnections(page);
  // l'agent IA actif est d'abord désactivé depuis sa page, puis on revient à Connexions
  await numberRow(page, '+33 1 84 80 12 34').getByRole('link', { name: /Support technique/ }).click();
  await page.getByRole('button', { name: 'Passer Offline' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Passer Offline' }).click();
  await expect(page.getByText('Ne répond plus. Ses conversations sont conservées.')).toBeVisible();
  await page.goto('/fr/organisation/connexions');
  await expect(numberRow(page, '+33 1 84 80 12 34').getByText('Offline', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Gérer (Boutique principale)' }).click();
  await page.getByRole('menuitem', { name: 'Retirer le compte' }).click();
  await page.getByRole('dialog', { name: 'Retirer le compte Boutique principale ?' }).getByRole('button', { name: 'Retirer le compte' }).click();

  // audit R-19 : la réussite est dite ; lot R1 : retrait propre chez Meta, aucune fenêtre de bilan
  await expect(page.getByRole('region', { name: 'Notifications' }).getByText('Compte WhatsApp Boutique principale retiré.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Aucun compte WhatsApp raccordé' })).toBeVisible();
  await expect(CONNECTIONS_LINK(page)).toHaveAccessibleName('Connexions 0');
  await expect(page.getByText('1 compte retiré')).toBeVisible();
  // recette Q-5 : plus aucun « Déconnecter » à l'écran
  await expect(page.getByText(/Déconnect/)).toHaveCount(0);
});

// audit R-5, R-21, recette 3.6 : le motif précis du compte en erreur et le conseil de sa cause
test('compte en erreur pour un contrôle refusé : le motif, « si cela continue, remplacez les identifiants » avec son bouton, jamais la reprise automatique', async ({ page, request }) => {
  await applyScenario(request, 'account-error-check');
  await openConnections(page);
  const account = page.getByRole('region', { name: 'Boutique principale' });
  const alert = account.getByRole('alert').filter({ hasText: 'La dernière vérification du compte a échoué.' });
  await expect(alert).toContainText("Motif : Secret de l'app refusé.");
  await expect(alert).toContainText('Vérifiez de nouveau ; si cela continue, remplacez les identifiants.');
  await expect(alert).not.toContainText('reprise automatique');
  await alert.getByRole('button', { name: 'Remplacer les identifiants' }).click();
  await expect(page.getByRole('dialog', { name: 'Remplacer les identifiants' })).toBeVisible();
});

// recette 3.6 : « Vérifier maintenant » dans le bandeau ouvre la vérification du menu « Gérer » ; le compte revient
test('compte en erreur : « Vérifier maintenant » du bandeau vérifie le compte, qui redevient connecté, le bandeau disparaît', async ({ page, request }) => {
  await applyScenario(request, 'account-error-check');
  await openConnections(page);
  const account = page.getByRole('region', { name: 'Boutique principale' });
  const alert = account.getByRole('alert').filter({ hasText: 'La dernière vérification du compte a échoué.' });
  await alert.getByRole('button', { name: 'Vérifier maintenant' }).click();
  const dialog = page.getByRole('dialog', { name: 'Vérification du compte' });
  await expect(dialog.getByText('Vérification réussie.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await expect(account.getByText('Connecté', { exact: true }).first()).toBeVisible();
  await expect(account.getByRole('alert')).toHaveCount(0);
  await expect(CONNECTIONS_LINK(page)).toHaveAccessibleName('Connexions 1');
});

// prototype 17 : un compte en erreur se voit sur l'entrée Connexions de chaque page de l'espace ; recette 3.7 (remplace
// le grisé de « Changer d'agent IA » et de « Brancher ») : un agent IA Draft ou Offline se branche sur un numéro d'un
// compte en erreur, un agent IA Preview ou Online est grisé dans la fenêtre avec la raison des contrats
test('prototype 17, recette 3.7 : compte en erreur, « 1 en erreur » sur l\'entrée Connexions ; demo-3 Draft branché sur un numéro libre, demo-1 Online grisé avec sa raison', async ({ page, request }) => {
  await applyScenario(request, 'account-error-check');
  await openConnections(page);
  await expect(CONNECTIONS_LINK(page)).toHaveAccessibleName('Connexions 1 en erreur');
  await RAIL(page).getByRole('link', { name: /^Entités/ }).click();
  await expect(page.getByRole('heading', { name: 'Entités' })).toBeVisible();
  await expect(CONNECTIONS_LINK(page)).toHaveAccessibleName('Connexions 1 en erreur');
  await CONNECTIONS_LINK(page).click();
  await numberRow(page, '+33 1 84 80 12 34').getByRole('button', { name: /^Gérer \(/ }).click();
  await expect(page.getByRole('menuitem', { name: "Changer d'agent IA" })).not.toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');

  const assign = numberRow(page, '+33 6 12 45 78 90').getByRole('button', { name: 'Brancher sur un agent IA' });
  await expect(assign).not.toHaveAttribute('aria-disabled', 'true');
  await assign.click();
  const dialog = page.getByRole('dialog', { name: 'Brancher le numéro sur un agent IA' });
  const online = dialog.getByRole('radio', { name: /Support technique/ });
  await expect(online).toBeDisabled();
  await expect(online).toHaveAccessibleDescription(NOT_CONNECTED);
  const draft = dialog.getByRole('radio', { name: /Accueil boutique/ });
  await expect(draft).toBeEnabled();
  await draft.check();
  await dialog.getByRole('button', { name: 'Brancher' }).click();
  await expect(dialog).toHaveCount(0);
  // le faux moteur l'accepte, comme decideAssign des deux pilotes : la ligne nomme demo-3, toujours Draft
  const row = numberRow(page, '+33 6 12 45 78 90');
  await expect(row.getByRole('link', { name: 'Accueil boutique' })).toBeVisible();
  await expect(row.getByText('Draft', { exact: true })).toBeVisible();
});

// prototype 10 : la section CRM à venir est grisée, pastille Soon, bulle au focus
test('prototype 10 : section CRM grisée, « Soon », bulle « Disponible prochainement : … » au focus clavier', async ({ page }) => {
  await openConnections(page);
  const crm = page.getByRole('group', { name: 'CRM' });
  await expect(crm).toHaveAttribute('aria-disabled', 'true');
  await expect(crm.getByText('Soon')).toBeVisible();
  await crm.focus();
  await expect(page.getByRole('tooltip')).toHaveText(/^Disponible prochainement : le raccordement d'un CRM/);
});

// audit R-21 : le message du fournisseur (provider_text du moteur) est replié, fermé
test('compte en erreur avec un message du fournisseur : phrase du moteur dans le bandeau, texte du fournisseur dans un détail replié', async ({ page, request }) => {
  await applyScenario(request, 'account-error-provider-text');
  await openConnections(page);
  const alert = page.getByRole('region', { name: 'Boutique principale' }).getByRole('alert').filter({ hasText: 'La dernière vérification du compte a échoué.' });
  await expect(alert).toContainText('Motif : Meta a renvoyé une erreur.');
  const details = alert.locator('details');
  await expect(details).not.toHaveAttribute('open', '');
  await expect(details.getByText('(#200) Permissions error')).toBeHidden();
  await details.getByText('Texte renvoyé par le fournisseur').click();
  await expect(details.getByText('(#200) Permissions error')).toBeVisible();
});

// audit R-5 : app Meta tenue ailleurs, aucune promesse de reprise
test('compte en erreur « ne peut pas être raccordé » : le motif neutre et « Contactez le support », sans reprise automatique ni bouton de remplacement', async ({ page, request }) => {
  await applyScenario(request, 'account-error-cannot-connect');
  await openConnections(page);
  const account = page.getByRole('region', { name: 'Boutique principale' });
  const alert = account.getByRole('alert').filter({ hasText: 'Ce compte ne peut pas être raccordé.' });
  await expect(alert).toContainText('Contactez le support.');
  await expect(alert).not.toContainText('reprise automatique');
  // recette 3.6 : seul « Vérifier maintenant », jamais de bouton de remplacement
  await expect(alert.getByRole('button')).toHaveText(['Vérifier maintenant']);
});

// recette K-6 : compte qui ne peut pas être raccordé, « Gérer » grise ce qui ne le répare pas, avec la raison
test('compte « ne peut pas être raccordé » : « Remplacer les identifiants » et « Rafraîchir les numéros » grisés dans « Gérer », avec leur raison', async ({ page, request }) => {
  await applyScenario(request, 'account-error-cannot-connect');
  await openConnections(page);
  await page.getByRole('button', { name: 'Gérer (Boutique principale)' }).click();
  for (const name of ['Remplacer les identifiants', 'Rafraîchir les numéros']) {
    const item = page.getByRole('menuitem', { name });
    await expect(item).toHaveAttribute('aria-disabled', 'true');
    await expect(item).toHaveAccessibleDescription('Ce compte ne peut pas être raccordé : contactez le support.');
  }
  await page.getByRole('menuitem', { name: 'Rafraîchir les numéros' }).dispatchEvent('click');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Vérifier maintenant' })).not.toHaveAttribute('aria-disabled');
});

// revue finale M-1 : des identifiants enregistrés illisibles ne se remplacent pas, le bandeau ne le propose pas
test('compte aux identifiants illisibles : « Retirez le compte puis raccordez-le de nouveau. », sans bouton de remplacement', async ({ page, request }) => {
  await applyScenario(request, 'account-error-unreadable');
  await openConnections(page);
  const account = page.getByRole('region', { name: 'Boutique principale' });
  const alert = account.getByRole('alert').filter({ hasText: 'La dernière vérification du compte a échoué.' });
  await expect(alert).toContainText('Motif : Identifiants enregistrés illisibles. Retirez le compte puis raccordez-le de nouveau.');
  await expect(alert).not.toContainText('remplacez les identifiants');
  // recette 3.6 : seul « Vérifier maintenant », jamais de bouton de remplacement
  await expect(alert.getByRole('button')).toHaveText(['Vérifier maintenant']);
});

// audit décisions A23 : parcours complet d'un compte aux identifiants illisibles, retirer puis raccorder de nouveau
test("identifiants illisibles : « Remplacer les identifiants » désactivé avec sa raison, retirer le compte puis raccorder la même WABA", async ({ page, request }) => {
  await applyScenario(request, 'account-error-unreadable');
  await openConnections(page);
  await page.getByRole('button', { name: 'Gérer (Boutique principale)' }).click();
  const replace = page.getByRole('menuitem', { name: 'Remplacer les identifiants' });
  await expect(replace).toHaveAttribute('aria-disabled', 'true');
  await expect(replace).toHaveAccessibleDescription('Les identifiants enregistrés ne se lisent plus : retirez le compte puis raccordez-le de nouveau.');
  // Playwright refuse de cliquer un élément `aria-disabled` : le clic est envoyé tel quel, il reste sans effet
  await replace.dispatchEvent('click');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // revue de la tâche 19 : « Rafraîchir les numéros » ne peut pas réussir non plus, même raison ; « Vérifier maintenant » reste actif
  const refresh = page.getByRole('menuitem', { name: 'Rafraîchir les numéros' });
  await expect(refresh).toHaveAttribute('aria-disabled', 'true');
  await expect(refresh).toHaveAccessibleDescription('Les identifiants enregistrés ne se lisent plus : retirez le compte puis raccordez-le de nouveau.');
  await expect(page.getByRole('menuitem', { name: 'Vérifier maintenant' })).not.toHaveAttribute('aria-disabled');

  // la suite indiquée : « Retirer le compte », refusé tant qu'un agent IA en service tient un numéro du compte, qui est nommé
  await page.getByRole('menuitem', { name: 'Retirer le compte' }).click();
  let dialog = page.getByRole('dialog', { name: 'Retirer le compte Boutique principale ?' });
  await dialog.getByRole('button', { name: 'Retirer le compte' }).click();
  await expect(dialog.getByRole('list', { name: 'Agents IA qui utilisent ce compte' }).getByRole('listitem')).toHaveText(['Support technique']);
  await dialog.getByRole('button', { name: 'Annuler' }).click();

  // l'agent IA est désactivé depuis sa page, puis le compte est retiré
  await numberRow(page, '+33 1 84 80 12 34').getByRole('link', { name: /Support technique/ }).click();
  await page.getByRole('button', { name: 'Passer Offline' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Passer Offline' }).click();
  await expect(page.getByText('Ne répond plus. Ses conversations sont conservées.')).toBeVisible();
  await page.goto('/fr/organisation/connexions');
  await page.getByRole('button', { name: 'Gérer (Boutique principale)' }).click();
  await page.getByRole('menuitem', { name: 'Retirer le compte' }).click();
  dialog = page.getByRole('dialog', { name: 'Retirer le compte Boutique principale ?' });
  await dialog.getByRole('button', { name: 'Retirer le compte' }).click();
  // lot R1 (spec R1 §5.5) : identifiants illisibles, le moteur n'a rien pu faire chez Meta ; le bilan est dit avant la fermeture.
  // Audit des décisions R1 (F-2, A-2) : désabonnement en échec, webhook de l'app non lu (jamais « pointe encore »).
  const outcome = page.getByRole('dialog', { name: 'Compte Boutique principale retiré' });
  await expect(outcome.getByText("L'app Meta n'a pas pu être désabonnée de ce compte WhatsApp : ses messages partent encore vers WABAGENT, qui ne les traite plus. Contactez le support.")).toBeVisible();
  await expect(outcome.getByText("WABAGENT n'a pas pu lire le webhook de votre app Meta. Vérifiez-le dans le tableau de bord de l'app Meta, WhatsApp, Configuration.")).toBeVisible();
  await expect(outcome.getByText(/pointe encore/)).toHaveCount(0);
  await outcome.getByRole('button', { name: 'Fermer' }).click();
  await expect(page.getByRole('region', { name: 'Notifications' }).getByText('Compte WhatsApp Boutique principale retiré.')).toBeVisible();

  // raccorder de nouveau la même WABA réussit ; plus aucun compte : l'action est dans l'encart vide, pas de bouton rond
  // (spec en-tête 7.5)
  await expect(page.locator('[data-page-create]')).toHaveCount(0);
  await page.getByRole('link', { name: '+ Raccorder un compte WhatsApp' }).click();
  await page.getByLabel("Adresse d'une page Meta Business ou ID du portefeuille").fill('1270659448489249');
  await page.getByText("J'ai déjà un compte WhatsApp Business").click();
  await page.getByLabel('Nom du compte dans WABAGENT').fill('Boutique principale');
  await page.getByLabel('ID du compte WhatsApp Business (WABA)').fill('104829371625544');
  await page.getByLabel("Jeton d'accès").fill('EAAGtokenvalide-0123456789');
  await page.getByLabel("Secret de l'app").fill('secretdelappmeta0123');
  await page.getByRole('button', { name: 'Vérifier et raccorder' }).click();
  await expect(page.getByRole('heading', { name: 'Compte raccordé' })).toBeVisible();
  await page.getByRole('link', { name: 'Terminer' }).click();
  const account = page.getByRole('region', { name: 'Boutique principale' });
  await expect(account.locator('header').getByText('Connecté', { exact: true })).toBeVisible();
});

// audit R-6, recette Q-6 : échecs de remise d'un numéro, « Brancher » direct sur le numéro libre
test('échecs de remise : pastille, sens du code 131047 et lien WhatsApp Manager sur la ligne du numéro', async ({ page, request }) => {
  await applyScenario(request, 'delivery-failures');
  await openConnections(page);
  const free = numberRow(page, '+33 6 12 45 78 90');
  await expect(free.getByText('3 échecs de remise')).toBeVisible();
  await expect(free.getByText(/Plus de 24 heures depuis la dernière réponse du contact/)).toBeVisible();
  await expect(free.getByRole('link', { name: 'Voir dans WhatsApp Manager ↗' })).toHaveAttribute('href', /waba_id=104829371625544/);
  // « Brancher » est un bouton direct (nom complet pour les lecteurs d'écran), « Gérer ▾ » reste à côté
  await expect(free.getByRole('button', { name: 'Brancher sur un agent IA' })).toHaveText('Brancher');
  await expect(free.getByRole('button', { name: 'Gérer (+33 6 12 45 78 90)' })).toBeVisible();
  // les autres numéros n'ont aucun échec
  await expect(numberRow(page, '+33 1 84 80 12 34').getByText(/échec/)).toHaveCount(0);
});

// prototype 5 : refus sur place (spec 10.6), à la même adresse, sans les comptes ni les numéros
test("un conseiller qui ouvre l'adresse de Connexions voit le refus sur place", async ({ page }) => {
  await loginToAgents(page, 'advisor@wabagent.test');
  const accountReads: string[] = [];
  page.on('request', (req) => { if (req.url().includes('/api/whatsapp-accounts')) accountReads.push(req.url()); });
  await page.goto('/fr/organisation/connexions');

  await expect(page.getByRole('heading', { name: 'Page réservée aux administrateurs', level: 1 })).toBeVisible();
  await expect(page.getByText('Cette page de l\'organisation Maison Lumière est réservée aux administrateurs.')).toBeVisible();
  await expect(page).toHaveURL(/\/fr\/organisation\/connexions$/);
  expect(accountReads).toEqual([]);
  await expect(page.getByRole('heading', { name: 'Connexions', level: 1 })).toHaveCount(0);
  await expect(rail(page).getByRole('link', { name: 'Organisation' })).toHaveCount(0);
});

// recette 10 nov. 2026 : les fenêtres ouvertes depuis une cellule alignée à droite avaient titre et texte à droite.
test('fenêtres « Brancher le numéro sur un agent IA » et « Débrancher » : titre et texte alignés à gauche', async ({ page }) => {
  await openConnections(page);
  // ouvertes depuis le menu « Gérer » (cellule alignée à droite) : « Changer d'agent IA » puis « Débrancher »
  await numberRow(page, '+33 1 84 80 12 34').getByRole('button', { name: /^Gérer \(/ }).click();
  await page.getByRole('menuitem', { name: "Changer d'agent IA" }).click();
  const assign = page.getByRole('dialog', { name: 'Brancher le numéro sur un agent IA' });
  await expect(assign).toBeVisible();
  for (const el of [assign.getByRole('heading'), assign.getByText("Choisissez l'agent IA de l'organisation")]) {
    expect(await el.evaluate((node) => getComputedStyle(node).textAlign)).toBe('left');
  }
  await assign.getByRole('button', { name: 'Annuler' }).click();

  await numberRow(page, '+33 1 84 80 12 34').getByRole('button', { name: /^Gérer \(/ }).click();
  await page.getByRole('menuitem', { name: 'Débrancher' }).click();
  const unassign = page.getByRole('dialog', { name: 'Débrancher Support technique ?' });
  await expect(unassign).toBeVisible();
  expect(await unassign.getByRole('heading').evaluate((node) => getComputedStyle(node).textAlign)).toBe('left');
  expect(await unassign.locator('p').first().evaluate((node) => getComputedStyle(node).textAlign)).toBe('left');
});

// recette 10 nov. 2026 : depuis la page de l'agent IA, le numéro était coupé sur six lignes à côté de deux pastilles.
test("fenêtre « Brancher un numéro » de la page d'un agent IA : numéro sur une ligne, texte du changement immédiat", async ({ page }) => {
  await openConnections(page);
  // le numéro de test passe sur Support technique : il aura deux pastilles (Numéro de test, Utilisé par ...)
  await numberRow(page, '+1 555 164 9072').getByRole('button', { name: 'Brancher sur un agent IA' }).click();
  const assign = page.getByRole('dialog', { name: 'Brancher le numéro sur un agent IA' });
  await assign.getByRole('radio', { name: /Support technique/ }).check();
  await assign.getByRole('button', { name: 'Brancher', exact: true }).click();
  await expect(assign).toHaveCount(0);

  await page.goto('/fr/agents/demo-3');
  await page.getByRole('button', { name: 'Brancher un numéro' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Brancher un numéro' });
  const radio = dialog.getByRole('radio', { name: /\+1 555 164 9072/ });
  await expect(radio).toBeAttached();
  const phone = dialog.getByText('+1 555 164 9072', { exact: true });
  const box = await phone.boundingBox();
  expect(box).not.toBeNull();
  // une seule ligne de texte (13 px, interligne normal) : bien moins de 24 px de haut
  expect(box!.height).toBeLessThan(24);
  await phone.click();
  await expect(dialog).toContainText('Support technique sera débranché de ce numéro tout de suite');
  await expect(dialog).not.toContainText("À l'activation");
});

// ---------- Lot R1 : raccordement Meta automatique ----------

// spec R1 §2 et §6.2 : WABAGENT inscrit lui-même les webhooks de la WABA et de l'app, rien n'est à recopier chez Meta
test('raccordement Meta : aucun écran de webhook à recopier, contrôles webhook affichés', async ({ page }) => {
  // la route du webhook (clé d'URL et jeton) n'est lue par aucun écran pour un compte Meta
  const webhookReads: string[] = [];
  page.on('request', (req) => {
    if (/\/api\/whatsapp-accounts\/\d+\/webhook$/.test(new URL(req.url()).pathname)) webhookReads.push(req.url());
  });
  await openConnections(page);
  await page.getByRole('link', { name: 'Raccorder un compte WhatsApp', exact: true }).click();
  await page.getByLabel("Adresse d'une page Meta Business ou ID du portefeuille").fill('1270659448489249');
  await page.getByText("J'ai déjà un compte WhatsApp Business").click();
  await page.getByLabel('Nom du compte dans WABAGENT').fill('Atelier Rive Gauche');
  await page.getByLabel('ID du compte WhatsApp Business (WABA)').fill('556677889900112');
  await page.getByLabel("Jeton d'accès").fill('EAAGtokenvalide-0123456789');
  await page.getByLabel("Secret de l'app").fill('secretdelappmeta0123');
  await page.getByRole('button', { name: 'Vérifier et raccorder' }).click();
  await expect(page.getByRole('heading', { name: 'Compte raccordé' })).toBeVisible();

  // les deux contrôles webhook du moteur sont dans la liste des contrôles, inscrits (« inscrit chez Meta », audit des
  // décisions R1 N-9)
  const checks = page.getByRole('list', { name: 'Contrôles de vérification' });
  for (const label of ['Webhook de la WABA chez Meta', "Webhook de l'app Meta"]) {
    const line = checks.getByRole('listitem').filter({ hasText: label });
    await expect(line).toHaveCount(1);
    await expect(line).toContainText('inscrit chez Meta');
    await expect(line).not.toContainText('abonnement créé');
  }
  // l'état des webhooks est dit, en lecture seule : ni bouton, ni adresse, ni jeton, ni « Dernière étape chez Meta »
  await expect(page.getByRole('group', { name: 'Webhooks et état du compte chez Meta' }).getByText('Webhook inscrit chez Meta.')).toBeVisible();
  await expect(page.getByText('Dernière étape chez Meta')).toHaveCount(0);
  await expect(page.getByText(/\/webhook\/meta\//)).toHaveCount(0);
  await expect(page.getByText(/Jeton de vérification/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Copier/ })).toHaveCount(0);

  // carte du nouveau compte dans Connexions : même état, toujours rien à recopier
  await page.getByRole('link', { name: 'Terminer' }).click();
  const created = page.getByRole('region', { name: 'Atelier Rive Gauche' });
  await expect(created.getByRole('group', { name: 'Webhooks et état du compte chez Meta' }).getByText('Webhook inscrit chez Meta.')).toBeVisible();
  await expect(page.getByText(/\/webhook\/meta\//)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Afficher' })).toHaveCount(0);
  expect(webhookReads).toEqual([]);
});

// spec R1 §5.6 : un abonnement de la WABA disparu chez Meta se dit avec quoi faire ; « Vérifier maintenant » le réinscrit
test('webhook de la WABA absent chez Meta : « Vérifier maintenant » le réinscrit, la ligne redevient « Webhook inscrit chez Meta. »', async ({ page, request }) => {
  await applyScenario(request, 'account-waba-missing');
  await openConnections(page);
  const webhooks = page.getByRole('region', { name: 'Boutique principale' }).getByRole('group', { name: 'Webhooks et état du compte chez Meta' });
  const missing = webhooks.getByRole('status').filter({ hasText: 'Webhook absent chez Meta :' });
  await expect(missing).toContainText('Webhook absent chez Meta : lancez Vérifier maintenant.');
  await missing.getByRole('button', { name: 'Vérifier maintenant' }).click();
  const dialog = page.getByRole('dialog', { name: 'Vérification du compte' });
  await expect(dialog.getByText('Vérification réussie.')).toBeVisible();
  // Audit des décisions R1 N-9 (A-6) : un webhook inscrit par le moteur se dit « inscrit chez Meta ».
  await expect(dialog.getByRole('list', { name: 'Contrôles de vérification' }).getByRole('listitem').filter({ hasText: 'Webhook de la WABA chez Meta' })).toContainText('inscrit chez Meta');
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await expect(webhooks.getByText('Webhook inscrit chez Meta.')).toBeVisible();
  await expect(webhooks.getByText('Webhook absent chez Meta :')).toHaveCount(0);
});

// spec R1 §5.4 et §10 question 1 : le webhook de l'app pointe vers un autre outil ; l'admin confirme, le domaine est répété
test('app elsewhere puis Faire pointer vers WABAGENT', async ({ page, request }) => {
  await applyScenario(request, 'account-app-elsewhere');
  await openConnections(page);
  const webhooks = page.getByRole('region', { name: 'Boutique principale' }).getByRole('group', { name: 'Webhooks et état du compte chez Meta' });
  const elsewhere = webhooks.getByRole('status').filter({ hasText: 'Le webhook de votre app Meta pointe vers crm.exemple.fr :' });
  await expect(elsewhere).toContainText("Le webhook de votre app Meta pointe vers crm.exemple.fr : les alertes de compte de Meta n'arrivent pas à WABAGENT.");
  // le webhook de la WABA, lui, est inscrit
  await expect(webhooks.getByText('Webhook inscrit chez Meta.')).toBeVisible();

  // annuler ne change rien
  await elsewhere.getByRole('button', { name: 'Faire pointer vers WABAGENT' }).click();
  let dialog = page.getByRole('dialog', { name: "Faire pointer le webhook de l'app vers WABAGENT ?" });
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(elsewhere).toBeVisible();

  await elsewhere.getByRole('button', { name: 'Faire pointer vers WABAGENT' }).click();
  dialog = page.getByRole('dialog', { name: "Faire pointer le webhook de l'app vers WABAGENT ?" });
  await expect(dialog.getByText(
    "Le webhook de votre app Meta pointe aujourd'hui vers crm.exemple.fr. Il pointera vers WABAGENT : crm.exemple.fr ne recevra plus les événements de cette app Meta.",
  )).toBeVisible();
  await dialog.getByRole('button', { name: 'Faire pointer vers WABAGENT' }).click();

  // la réussite est dite dans la fenêtre, la page se relit : la ligne « pointe vers » disparaît ; recette R1 du
  // 12 nov. 2026, retouche 3 : le titre n'est plus une question
  dialog = page.getByRole('dialog', { name: "Webhook de l'app Meta pointé vers WABAGENT" });
  await expect(dialog.getByRole('status')).toHaveText('Le webhook de votre app Meta pointe maintenant vers WABAGENT.');
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(webhooks.getByText(/crm\.exemple\.fr/)).toHaveCount(0);
  await expect(webhooks.getByText('Webhook inscrit chez Meta.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Faire pointer vers WABAGENT' })).toHaveCount(0);
});

// ruling R-15 : un refus du moteur se lit par sa clé, l'état du compte ne change pas et le bouton reste
// Audit des décisions R1 P-3 (A-5) : texte propre à la fenêtre, la cause du moteur repliée sous le texte.
test('Faire pointer vers WABAGENT refusé par le moteur : texte propre à la fenêtre, cause repliée, la ligne et le bouton restent', async ({ page, request }) => {
  await applyScenario(request, 'account-app-elsewhere');
  await forceResponse(request, {
    route: '/whatsapp-accounts/1/app-webhook', method: 'POST', status: 422, code: 'WA_VALIDATION_FAILED',
    message: "WABAGENT n'a pas pu lire ou inscrire le webhook de votre app Meta.", reason: 'whatsapp_account.app_webhook_failed',
    details: [{ path: 'webhook_app', message: "WABAGENT n'a pas pu lire ou inscrire le webhook de votre app Meta." }],
  });
  await openConnections(page);
  const webhooks = page.getByRole('region', { name: 'Boutique principale' }).getByRole('group', { name: 'Webhooks et état du compte chez Meta' });
  await webhooks.getByRole('button', { name: 'Faire pointer vers WABAGENT' }).click();
  const dialog = page.getByRole('dialog', { name: "Faire pointer le webhook de l'app vers WABAGENT ?" });
  await dialog.getByRole('button', { name: 'Faire pointer vers WABAGENT' }).click();
  await expect(dialog.getByRole('alert')).toContainText("WABAGENT n'a pas pu inscrire le webhook de votre app Meta. Réessayez.");
  await expect(dialog.getByRole('alert')).not.toContainText('Vérifier maintenant');
  // le détail du moteur n'est pas en clair : replié sous « Détail de WABAGENT », ouvert sur demande
  const cause = dialog.getByText("WABAGENT n'a pas pu lire ou inscrire le webhook de votre app Meta.");
  await expect(cause).toBeHidden();
  await dialog.locator('details summary').click();
  await expect(cause).toBeVisible();
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await expect(webhooks.getByText('Le webhook de votre app Meta pointe vers crm.exemple.fr :')).toBeVisible();
  await expect(webhooks.getByRole('button', { name: 'Faire pointer vers WABAGENT' })).toBeVisible();
});

// spec R1 §6.2 : même phrase dans l'encart Numéro de la page de l'agent IA, sans bouton, avec le lien vers Connexions
test("app elsewhere : l'encart Numéro de l'agent IA dit la même phrase, sans bouton, avec « Voir dans Connexions »", async ({ page, request }) => {
  await applyScenario(request, 'account-app-elsewhere');
  await openConnections(page);
  await numberRow(page, '+33 1 84 80 12 34').getByRole('link', { name: /Support technique/ }).click();
  await expect(page.getByRole('heading', { name: 'Numéro WhatsApp' })).toBeVisible();
  const webhooks = page.getByRole('group', { name: 'Webhooks et état du compte chez Meta' });
  await expect(webhooks.getByText('Le webhook de votre app Meta pointe vers crm.exemple.fr :')).toBeVisible();
  await expect(webhooks.getByRole('button')).toHaveCount(0);
  await page.getByRole('link', { name: 'Voir dans Connexions' }).click();
  await expect(page.getByRole('heading', { name: 'Connexions', level: 1 })).toBeVisible();
});

// spec R1 §5.5 : le bilan du retrait chez Meta est dit avant la fermeture quand il reste quelque chose à faire chez Meta
test('retrait d\'un compte Meta : la fenêtre « Compte Boutique principale retiré » dit le webhook de l\'app laissé et le retrait chez Meta en échec', async ({ page, request }) => {
  await applyScenario(request, 'disconnect-app-left');
  await openConnections(page);
  await numberRow(page, '+33 1 84 80 12 34').getByRole('link', { name: /Support technique/ }).click();
  await page.getByRole('button', { name: 'Passer Offline' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Passer Offline' }).click();
  await expect(page.getByText('Ne répond plus. Ses conversations sont conservées.')).toBeVisible();
  await page.goto('/fr/organisation/connexions');

  await page.getByRole('button', { name: 'Gérer (Boutique principale)' }).click();
  await page.getByRole('menuitem', { name: 'Retirer le compte' }).click();
  await page.getByRole('dialog', { name: 'Retirer le compte Boutique principale ?' }).getByRole('button', { name: 'Retirer le compte' }).click();

  const done = page.getByRole('dialog', { name: 'Compte Boutique principale retiré' });
  await expect(done.getByText("Le webhook de votre app Meta pointe encore vers ce compte retiré. Pour le changer : tableau de bord de l'app Meta, WhatsApp, Configuration.")).toBeVisible();
  await expect(done.getByText("L'app Meta n'a pas pu être désabonnée de ce compte WhatsApp : ses messages partent encore vers WABAGENT, qui ne les traite plus. Contactez le support.")).toBeVisible();
  await done.getByRole('button', { name: 'Fermer' }).click();
  await expect(done).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Aucun compte WhatsApp raccordé' })).toBeVisible();
  await expect(CONNECTIONS_LINK(page)).toHaveAccessibleName('Connexions 0');
});

// ---------- Lot R2a : guide en deux temps, profil WhatsApp et nom d'affichage ----------

const BUSINESS_FIELD = "Adresse d'une page Meta Business ou ID du portefeuille";
const WABA_FIELD = 'ID du compte WhatsApp Business (WABA)';
const NEW_WABA = '556677889900112';
/** Adresse d'une page de WhatsApp Manager telle que l'administrateur la copie : portefeuille et WABA (`asset_id`). */
const managerAddress = (business: string) =>
  `https://business.facebook.com/latest/whatsapp_manager/phone_numbers/?business_id=${business}&asset_id=${NEW_WABA}&nav_ref=whatsapp_manager`;
/** Photo PNG de 1 × 1 pixel : le contenu est contrôlé par sa signature, la taille minimale l'est par Meta. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/** Ouvre la fenêtre « Profil WhatsApp » du numéro libre de Boutique principale par son menu « Gérer ». */
async function openProfile(page: Page) {
  await numberRow(page, '+33 6 12 45 78 90').getByRole('button', { name: 'Gérer (+33 6 12 45 78 90)' }).click();
  await page.getByRole('menuitem', { name: 'Profil WhatsApp' }).click();
  const dialog = page.getByRole('dialog', { name: 'Profil WhatsApp du +33 6 12 45 78 90' });
  await expect(dialog).toBeVisible();
  return dialog;
}

// spec R2a §5.1, points 2, 5 et 6, ruling R-22 : l'adresse collée de WhatsApp Manager donne le portefeuille et la WABA,
// choisit le chemin 1 ; le moteur vérifie le portefeuille chez Meta et nomme celui qu'il a lu quand il diffère
test('raccordement : adresse WhatsApp Manager collée, chemin 1, résultat avec portefeuille', async ({ page }) => {
  const sent: unknown[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/whatsapp-accounts') sent.push(req.postDataJSON());
  });
  await openConnections(page);
  await page.getByRole('link', { name: 'Raccorder un compte WhatsApp', exact: true }).click();
  const paths = page.getByRole('radiogroup', { name: "D'où partez-vous ?" });
  const existing = paths.getByRole('radio', { name: "J'ai déjà un compte WhatsApp Business" });
  // ruling R-22 : aucun chemin choisi d'avance
  await expect(paths.getByRole('radio', { checked: true })).toHaveCount(0);

  // adresse d'une page d'un autre portefeuille : reconnue, la WABA est préremplie et le chemin 1 choisi
  const other = '9988776655443322';
  await page.getByLabel(BUSINESS_FIELD).fill(managerAddress(other));
  const recognised = page.getByRole('status').filter({ hasText: `Portefeuille ${other} reconnu.` });
  await expect(recognised).toContainText(`Compte WhatsApp ${NEW_WABA} repéré dans l'adresse : prérempli plus bas.`);
  await expect(existing).toBeChecked();
  await expect(page.getByLabel(WABA_FIELD)).toHaveValue(NEW_WABA);
  // étapes du chemin 1, liens précis du portefeuille saisi
  await expect(page.getByRole('link', { name: /^Ouvrir les informations de l'entreprise/ })).toHaveAttribute('href', `https://business.facebook.com/latest/settings/business_info?business_id=${other}`);
  await page.getByLabel("Jeton d'accès").fill('EAAGtokenvalide-0123456789');
  await page.getByLabel("Secret de l'app").fill('secretdelappmeta0123');
  await page.getByLabel('Nom du compte dans WABAGENT').fill('Atelier Rive Gauche');
  await page.getByRole('button', { name: 'Vérifier et raccorder' }).click();

  // le portefeuille lu chez Meta n'est pas celui saisi : il est nommé, rien n'est raccordé
  await expect(page.getByRole('alert').filter({ hasText: 'Ce compte WhatsApp appartient au portefeuille' })).toHaveText(
    `Ce compte WhatsApp appartient au portefeuille ${META_BUSINESS.name} (${META_BUSINESS.id}), pas à celui que vous avez saisi. Vérifiez le portefeuille ou le WABA ID.`,
  );
  await expect(page.getByRole('heading', { name: 'Compte raccordé' })).toHaveCount(0);
  expect(sent).toEqual([expect.objectContaining({ mode: 'meta_manual', business_id: other, waba_id: NEW_WABA })]);

  // adresse du bon portefeuille : même WABA, le chemin reste le 1, le compte est raccordé avec son portefeuille
  await page.getByLabel(BUSINESS_FIELD).fill(managerAddress(META_BUSINESS.id));
  await expect(existing).toBeChecked();
  await expect(page.getByLabel(WABA_FIELD)).toHaveValue(NEW_WABA);
  await page.getByRole('button', { name: 'Vérifier et raccorder' }).click();
  await expect(page.getByRole('heading', { name: 'Compte raccordé' })).toBeVisible();
  await expect(page.getByText(`Portefeuille ${META_BUSINESS.name}`, { exact: true })).toBeVisible();
  expect(sent[1]).toEqual(expect.objectContaining({ business_id: META_BUSINESS.id, waba_id: NEW_WABA }));

  // le portefeuille est gardé avec le compte : les liens de WhatsApp Manager du numéro ouvrent ses pages
  await page.getByRole('link', { name: 'Terminer' }).click();
  const created = page.getByRole('region', { name: 'Atelier Rive Gauche' });
  await created.getByRole('button', { name: /^Gérer \(\+/ }).click();
  await expect(page.getByRole('menuitem', { name: 'Voir dans WhatsApp Manager ↗' })).toHaveAttribute(
    'href', `https://business.facebook.com/latest/whatsapp_manager/phone_numbers/?business_id=${META_BUSINESS.id}&asset_id=${NEW_WABA}`,
  );
});

// spec R2a §5.2 : profil lu chez Meta, seuls les champs modifiés sont envoyés, la version relue est affichée et gardée
// chez Meta (la fenêtre rouverte la relit) ; la photo est envoyée puis relue
test('profil : lecture, modification, enregistrement relu', async ({ page }) => {
  // photo servie par le faux Meta : interceptée, rien ne part sur le réseau
  await page.route(`${MOCK_PHOTO_HOST}/**`, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  const writes: unknown[] = [];
  page.on('request', (req) => {
    if (req.method() === 'PUT' && new URL(req.url()).pathname.endsWith('/numbers/2/profile')) writes.push(req.postDataJSON());
  });
  await openConnections(page);
  let dialog = await openProfile(page);

  // lecture chez Meta : champs et aperçu
  const about = dialog.getByLabel('Infos (statut sous le nom)');
  await expect(about).toHaveValue('Réponse en quelques minutes');
  await expect(dialog.getByLabel('Description')).toHaveValue('Notre équipe vous répond sur WhatsApp.');
  await expect(dialog.getByLabel('Secteur')).toHaveValue('RETAIL');
  await expect(dialog.getByLabel('Adresse', { exact: true })).toHaveValue('12 rue de la Paix, 75002 Paris');
  await expect(dialog.getByLabel('E-mail', { exact: true })).toHaveValue('contact@exemple.test');
  await expect(dialog.getByLabel('Site web', { exact: true })).toHaveValue('https://exemple.test');
  await expect(dialog.getByText(/^Lu chez Meta le /)).toBeVisible();
  const preview = dialog.getByRole('region', { name: 'Aperçu : ce que voit le contact' });
  await expect(preview).toContainText('Service client');
  await expect(preview).toContainText('Réponse en quelques minutes');

  // modification : l'aperçu suit la saisie avant tout enregistrement ; une adresse vidée est envoyée vide
  await about.fill('Ouvert du lundi au samedi');
  await dialog.getByLabel('Adresse', { exact: true }).fill('');
  await expect(preview).toContainText('Ouvert du lundi au samedi');
  await expect(preview).not.toContainText('12 rue de la Paix');
  expect(writes).toEqual([]);
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Profil enregistré chez Meta.' })).toBeVisible();
  expect(writes).toEqual([{ about: 'Ouvert du lundi au samedi', address: '' }]);

  // relu chez Meta : la fenêtre rouverte lit la version enregistrée
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await expect(dialog).toHaveCount(0);
  dialog = await openProfile(page);
  await expect(dialog.getByLabel('Infos (statut sous le nom)')).toHaveValue('Ouvert du lundi au samedi');
  await expect(dialog.getByLabel('Adresse', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('Description')).toHaveValue('Notre équipe vous répond sur WhatsApp.');
  await dialog.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(dialog.getByRole('status').filter({ hasText: 'Aucun changement à enregistrer.' })).toBeVisible();
  expect(writes).toHaveLength(1);

  // photo : envoyée à Meta, la photo relue s'affiche dans la fenêtre et dans l'aperçu
  await expect(dialog.getByRole('img', { name: 'Photo du profil' })).toHaveCount(0);
  await dialog.getByLabel('Changer la photo').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
  await expect(dialog.getByRole('status').filter({ hasText: 'Photo enregistrée chez Meta.' })).toBeVisible();
  await expect(dialog.getByRole('img', { name: 'Photo du profil' })).toHaveCount(2);
  await expect(dialog.getByRole('img', { name: 'Photo du profil' }).first()).toHaveAttribute('src', new RegExp(`^${MOCK_PHOTO_HOST}/`));
});

// spec R2a §5.3 et §13.2, rulings R-1, R-26 et R-28 : le nom demandé ou approuvé n'est jamais montré comme nom affiché ;
// un code refusé par Meta est dit et vidé, le bon code applique le nom, qui devient celui de la colonne « Nom affiché »
test("nom : demande, approuvé à appliquer, code refusé puis accepté", async ({ page, request }) => {
  await openConnections(page);
  const nameCell = numberRow(page, '+33 6 12 45 78 90').getByRole('cell').nth(1);
  await expect(page.getByRole('columnheader').nth(1)).toHaveText('Nom affiché');
  await expect(nameCell).toHaveText('Service client');

  // demande d'un nouveau nom : en revue chez Meta, le nom actuel reste affiché
  let dialog = await openProfile(page);
  let panel = dialog.getByRole('region', { name: 'Nom affiché' });
  await expect(panel).toContainText('Approuvé');
  await panel.getByRole('button', { name: 'Demander un autre nom' }).click();
  await panel.getByLabel('Nouveau nom').fill('Service client Paris');
  await panel.getByRole('button', { name: 'Envoyer la demande' }).click();
  await expect(panel.getByRole('status')).toHaveText('Demande envoyée à Meta.');
  await expect(panel.getByText('En revue chez Meta')).toBeVisible();
  await expect(panel).toContainText(/Nom demandé le .+ : Service client Paris\./);
  await expect(panel.locator('b').first()).toHaveText('Service client');
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await expect(nameCell).toContainText('Nouveau nom en revue');
  await expect(nameCell).not.toContainText('Paris');

  // Meta approuve le nom : à appliquer, signalé sur la carte, toujours pas affiché
  await applyScenario(request, 'display-name-approved');
  await page.reload();
  await expect(nameCell).toContainText('Nouveau nom à appliquer');
  await expect(nameCell).not.toContainText('Paris');
  const banner = page.getByRole('region', { name: 'Boutique principale' }).getByRole('status').filter({ hasText: 'Nouveau nom approuvé pour le +33 6 12 45 78 90' });
  await expect(banner).toContainText('« Service client Paris »');
  await expect(banner).toContainText("Il faut l'appliquer avant le");

  dialog = await openProfile(page);
  panel = dialog.getByRole('region', { name: 'Nom affiché' });
  await expect(panel.getByText('Approuvé, à appliquer')).toBeVisible();
  await expect(panel).toContainText('« Service client Paris » approuvé le');
  await expect(panel.locator('b').first()).toHaveText('Service client');
  // ruling R-28 : champ texte visible, jamais un mot de passe ; ruling R-26 : un code est actif, l'aide dit où le changer
  const code = panel.getByLabel('Code de vérification en deux étapes');
  await expect(code).toHaveAttribute('type', 'text');
  await expect(code).toHaveAttribute('autocomplete', 'one-time-code');
  await expect(panel.getByText(/Code oublié : changez-le dans/)).toBeVisible();

  // mauvais code : refusé par Meta, le refus propose de changer le code, le champ est vidé, rien n'est appliqué
  await code.fill('000000');
  await panel.getByRole('button', { name: 'Appliquer le nouveau nom' }).click();
  await expect(panel.getByRole('alert')).toContainText('Code de vérification en deux étapes refusé par Meta. Vérifiez-le ou changez-le dans WhatsApp Manager.');
  await expect(panel.getByRole('link', { name: 'Changer le code dans WhatsApp Manager ↗' })).toHaveAttribute(
    'href', `https://business.facebook.com/latest/whatsapp_manager/phone_numbers/?business_id=${META_BUSINESS.id}&asset_id=104829371625544`,
  );
  await expect(code).toHaveValue('');
  await expect(panel.locator('b').first()).toHaveText('Service client');

  // bon code : le nom est appliqué, la demande disparaît
  await code.fill(ACCEPTED_PIN);
  await panel.getByRole('button', { name: 'Appliquer le nouveau nom' }).click();
  await expect(panel.getByRole('status')).toHaveText('Nouveau nom appliqué.');
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(panel.getByLabel('Code de vérification en deux étapes')).toHaveCount(0);
  await expect(panel.locator('b').first()).toHaveText('Service client Paris');
  await expect(panel.getByText('Approuvé', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Fermer' }).click();

  // la colonne « Nom affiché » montre le nouveau nom, sans étiquette ; la carte ne signale plus rien à appliquer
  await expect(nameCell).toHaveText('Service client Paris');
  await expect(banner).toHaveCount(0);
});

// audit des décisions R2a, P-42 : un nom approuvé disparu chez Meta sans être appliqué est dit sur la carte et dans
// l'encart, pour le numéro nommé, jusqu'à une nouvelle demande, qui efface la trace
test("nom : délai dépassé dit sur la carte et dans l'encart, effacé par une nouvelle demande", async ({ page, request }) => {
  await applyScenario(request, 'display-name-expired');
  await openConnections(page);
  const nameCell = numberRow(page, '+33 6 12 45 78 90').getByRole('cell').nth(1);
  await expect(nameCell).toContainText('Service client');
  await expect(nameCell).toContainText('Délai dépassé');
  await expect(nameCell).not.toContainText('Paris');
  const banner = page.getByRole('region', { name: 'Boutique principale' }).getByRole('status').filter({ hasText: 'Le délai pour appliquer « Service client Paris » est dépassé.' });
  await expect(banner).toContainText('Demandez de nouveau ce nom.');
  await expect(banner).toContainText('Pour le +33 6 12 45 78 90');

  const dialog = await openProfile(page);
  const panel = dialog.getByRole('region', { name: 'Nom affiché' });
  await expect(panel.getByText('Délai dépassé')).toBeVisible();
  await expect(panel).toContainText('Le délai pour appliquer « Service client Paris » est dépassé. Demandez de nouveau ce nom.');
  await expect(panel.getByLabel('Code de vérification en deux étapes')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Demander un autre nom' }).click();
  await panel.getByLabel('Nouveau nom').fill('Service client Paris');
  await panel.getByRole('button', { name: 'Envoyer la demande' }).click();
  await expect(panel.getByRole('status')).toHaveText('Demande envoyée à Meta.');
  await expect(panel.getByText('En revue chez Meta')).toBeVisible();
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await expect(nameCell).toContainText('Nouveau nom en revue');
  await expect(banner).toHaveCount(0);
});
