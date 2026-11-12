import { test, expect, type Page } from '@playwright/test';
import { applyScenario, forceResponse, loginToAgents, rail, resetMock } from './helpers';

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
  await page.getByLabel('Nom du compte dans WABAGENT').fill('Atelier Rive Gauche');
  await page.getByLabel('ID du compte WhatsApp Business (WABA)').fill('556677889900112');
  await page.getByLabel("Jeton d'accès").fill('EAAGtokenvalide-0123456789');
  await page.getByLabel("Secret de l'app").fill('secretdelappmeta0123');
  await page.getByRole('button', { name: 'Vérifier et raccorder' }).click();
  await expect(page.getByRole('heading', { name: 'Compte raccordé' })).toBeVisible();

  // les deux contrôles webhook du moteur sont dans la liste des contrôles, inscrits (« abonnement créé »)
  const checks = page.getByRole('list', { name: 'Contrôles de vérification' });
  for (const label of ['Webhook de la WABA chez Meta', "Webhook de l'app Meta"]) {
    const line = checks.getByRole('listitem').filter({ hasText: label });
    await expect(line).toHaveCount(1);
    await expect(line).toContainText('abonnement créé');
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
  await expect(dialog.getByRole('list', { name: 'Contrôles de vérification' }).getByRole('listitem').filter({ hasText: 'Webhook de la WABA chez Meta' })).toContainText('abonnement créé');
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

  // la réussite est dite dans la fenêtre, la page se relit : la ligne « pointe vers » disparaît
  await expect(dialog.getByRole('status')).toHaveText('Le webhook de votre app Meta pointe maintenant vers WABAGENT.');
  await dialog.getByRole('button', { name: 'Fermer' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(webhooks.getByText(/crm\.exemple\.fr/)).toHaveCount(0);
  await expect(webhooks.getByText('Webhook inscrit chez Meta.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Faire pointer vers WABAGENT' })).toHaveCount(0);
});

// ruling R-15 : un refus du moteur se lit par sa clé, l'état du compte ne change pas et le bouton reste
test('Faire pointer vers WABAGENT refusé par le moteur : le texte de la clé app_webhook_failed, la ligne et le bouton restent', async ({ page, request }) => {
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
  await expect(dialog.getByRole('alert')).toContainText(
    "WABAGENT n'a pas pu inscrire le webhook de votre app Meta. Les messages arrivent, mais pas les alertes de compte de Meta. Réessayez avec Vérifier maintenant.",
  );
  // le texte brut du moteur n'est jamais affiché : seul celui de la clé
  await expect(dialog.getByText("WABAGENT n'a pas pu lire ou inscrire le webhook de votre app Meta.")).toHaveCount(0);
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
