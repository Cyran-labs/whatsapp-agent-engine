import { test, expect, type Page } from '@playwright/test';
import { applyScenario, loginToAgents, resetMock } from './helpers';

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
  await expect(branded.getByText('Ouvert à tous', { exact: true })).toBeVisible();
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
  await expect(checks.getByText('Compte WhatsApp (WABA)')).toBeVisible();
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

test("retirer le compte tenu par un agent IA actif de WABAGENT : le refus nomme l'agent IA, rien ne change", async ({ page }) => {
  await openConnections(page);
  // recette Q-6 : le menu est un bouton visible « Gérer ▾ »
  await expect(page.getByRole('region', { name: 'Boutique principale' }).locator('header').getByRole('button', { name: 'Gérer (Boutique principale)' })).toHaveText(/Gérer/);
  await page.getByRole('button', { name: 'Gérer (Boutique principale)' }).click();
  await page.getByRole('menuitem', { name: 'Retirer de WABAGENT' }).click();

  const dialog = page.getByRole('dialog', { name: 'Retirer Boutique principale de WABAGENT ?' });
  await dialog.getByRole('button', { name: 'Retirer le compte' }).click();

  await expect(dialog.getByRole('alert')).toHaveText("Désactivez d'abord les agents IA qui utilisent ce compte :");
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

test('un compte sans agent IA en service est retiré de WABAGENT : réussite notifiée, il quitte la liste et le compteur du rail', async ({ page }) => {
  await openConnections(page);
  // l'agent IA actif est d'abord désactivé depuis sa page, puis on revient à Connexions
  await numberRow(page, '+33 1 84 80 12 34').getByRole('link', { name: /Support technique/ }).click();
  await page.getByRole('button', { name: 'Désactiver' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Désactiver' }).click();
  await expect(page.getByText('Cet agent IA est désactivé : il ne répond plus.')).toBeVisible();
  await page.goto('/fr/organisation/connexions');
  await expect(numberRow(page, '+33 1 84 80 12 34').getByText('Désactivé', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Gérer (Boutique principale)' }).click();
  await page.getByRole('menuitem', { name: 'Retirer de WABAGENT' }).click();
  await page.getByRole('dialog', { name: 'Retirer Boutique principale de WABAGENT ?' }).getByRole('button', { name: 'Retirer le compte' }).click();

  // audit R-19 : la réussite est dite
  await expect(page.getByRole('region', { name: 'Notifications' }).getByText('Boutique principale retiré de WABAGENT.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Aucun compte WhatsApp raccordé' })).toBeVisible();
  await expect(CONNECTIONS_LINK(page)).toHaveAccessibleName('Connexions 0');
  await expect(page.getByText('1 compte retiré')).toBeVisible();
  // recette Q-5 : plus aucun « Déconnecter » à l'écran
  await expect(page.getByText(/Déconnect/)).toHaveCount(0);
});

// audit R-5, R-21 : le motif précis du compte en erreur et le conseil de sa cause
test('compte en erreur pour un contrôle refusé : le motif, « Remplacez les identifiants du compte » avec son bouton, jamais la reprise automatique', async ({ page, request }) => {
  await applyScenario(request, 'account-error-check');
  await openConnections(page);
  const account = page.getByRole('region', { name: 'Boutique principale' });
  const alert = account.getByRole('alert').filter({ hasText: 'Le compte est en erreur.' });
  await expect(alert).toContainText("Motif : Secret de l'app refusé.");
  await expect(alert).toContainText('Remplacez les identifiants du compte.');
  await expect(alert).not.toContainText('reprise automatique');
  await alert.getByRole('button', { name: 'Remplacer les identifiants' }).click();
  await expect(page.getByRole('dialog', { name: 'Remplacer les identifiants' })).toBeVisible();
});

// audit R-21 : le message du fournisseur (provider_text du moteur) est replié, fermé
test('compte en erreur avec un message du fournisseur : phrase du moteur dans le bandeau, texte du fournisseur dans un détail replié', async ({ page, request }) => {
  await applyScenario(request, 'account-error-provider-text');
  await openConnections(page);
  const alert = page.getByRole('region', { name: 'Boutique principale' }).getByRole('alert').filter({ hasText: 'Le compte est en erreur.' });
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
  await expect(alert.getByRole('button')).toHaveCount(0);
});

// revue finale M-1 : des identifiants enregistrés illisibles ne se remplacent pas, le bandeau ne le propose pas
test('compte aux identifiants illisibles : « Retirez ce compte de WABAGENT puis raccordez-le de nouveau. », sans bouton de remplacement', async ({ page, request }) => {
  await applyScenario(request, 'account-error-unreadable');
  await openConnections(page);
  const account = page.getByRole('region', { name: 'Boutique principale' });
  const alert = account.getByRole('alert').filter({ hasText: 'Le compte est en erreur.' });
  await expect(alert).toContainText('Motif : Identifiants enregistrés illisibles. Retirez ce compte de WABAGENT puis raccordez-le de nouveau.');
  await expect(alert).not.toContainText('Remplacez les identifiants');
  await expect(alert.getByRole('button')).toHaveCount(0);
});

// audit décisions A23 : parcours complet d'un compte aux identifiants illisibles, retirer puis raccorder de nouveau
test("identifiants illisibles : « Remplacer les identifiants » désactivé avec sa raison, retirer de WABAGENT puis raccorder la même WABA", async ({ page, request }) => {
  await applyScenario(request, 'account-error-unreadable');
  await openConnections(page);
  await page.getByRole('button', { name: 'Gérer (Boutique principale)' }).click();
  const replace = page.getByRole('menuitem', { name: 'Remplacer les identifiants' });
  await expect(replace).toHaveAttribute('aria-disabled', 'true');
  await expect(replace).toHaveAccessibleDescription('Les identifiants enregistrés ne se lisent plus : retirez ce compte de WABAGENT puis raccordez-le de nouveau.');
  // Playwright refuse de cliquer un élément `aria-disabled` : le clic est envoyé tel quel, il reste sans effet
  await replace.dispatchEvent('click');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // revue de la tâche 19 : « Rafraîchir les numéros » ne peut pas réussir non plus, même raison ; « Vérifier maintenant » reste actif
  const refresh = page.getByRole('menuitem', { name: 'Rafraîchir les numéros' });
  await expect(refresh).toHaveAttribute('aria-disabled', 'true');
  await expect(refresh).toHaveAccessibleDescription('Les identifiants enregistrés ne se lisent plus : retirez ce compte de WABAGENT puis raccordez-le de nouveau.');
  await expect(page.getByRole('menuitem', { name: 'Vérifier maintenant' })).not.toHaveAttribute('aria-disabled');

  // la suite indiquée : « Retirer de WABAGENT », refusé tant qu'un agent IA en service tient un numéro du compte, qui est nommé
  await page.getByRole('menuitem', { name: 'Retirer de WABAGENT' }).click();
  let dialog = page.getByRole('dialog', { name: 'Retirer Boutique principale de WABAGENT ?' });
  await dialog.getByRole('button', { name: 'Retirer le compte' }).click();
  await expect(dialog.getByRole('list', { name: 'Agents IA qui utilisent ce compte' }).getByRole('listitem')).toHaveText(['Support technique']);
  await dialog.getByRole('button', { name: 'Annuler' }).click();

  // l'agent IA est désactivé depuis sa page, puis le compte est retiré
  await numberRow(page, '+33 1 84 80 12 34').getByRole('link', { name: /Support technique/ }).click();
  await page.getByRole('button', { name: 'Désactiver' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Désactiver' }).click();
  await expect(page.getByText('Cet agent IA est désactivé : il ne répond plus.')).toBeVisible();
  await page.goto('/fr/organisation/connexions');
  await page.getByRole('button', { name: 'Gérer (Boutique principale)' }).click();
  await page.getByRole('menuitem', { name: 'Retirer de WABAGENT' }).click();
  dialog = page.getByRole('dialog', { name: 'Retirer Boutique principale de WABAGENT ?' });
  await dialog.getByRole('button', { name: 'Retirer le compte' }).click();
  await expect(page.getByRole('region', { name: 'Notifications' }).getByText('Boutique principale retiré de WABAGENT.')).toBeVisible();

  // raccorder de nouveau la même WABA réussit
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

test("un conseiller qui ouvre l'adresse de Connexions est renvoyé à l'accueil", async ({ page }) => {
  await loginToAgents(page, 'advisor@wabagent.test');
  await page.goto('/fr/organisation/connexions');

  await expect(page).toHaveURL(/\/fr\/?$/);
  await expect(page.getByRole('heading', { name: 'Tous les agents IA' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Connexions', level: 1 })).toHaveCount(0);
  await expect(page.getByRole('banner').getByRole('link', { name: 'Organisation' })).toHaveCount(0);
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
