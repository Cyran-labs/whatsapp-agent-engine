/**
 * Garde de restitution (audit §3, 34 actions d'écriture ; règle §5.1 à §5.3). Pour chaque action :
 * - un refus du moteur (409, 400, 404, 422 selon l'action) s'affiche à son emplacement (champ, fenêtre, ligne, panneau),
 *   jamais en notification, avec le texte de l'interface (clé `reason`) et non un texte du moteur ;
 * - une panne 500 s'affiche à l'endroit de l'action avec le texte contextuel de l'écran et la référence de la requête ;
 * - une réussite est visible (état changé, et notification quand la fenêtre se ferme ou que l'élément sort de la vue).
 * Les refus et pannes viennent du faux moteur (`forceResponse`, `POST /__fail`) ; les textes attendus sont lus dans
 * `messages/<locale>.json` (`msg`). Les cas déjà garantis par un autre fichier sont cités dans le rapport de la tâche 16.
 * Les défauts D-1 à D-3 trouvés par la tâche 16 (texte brut du moteur, référence absente) sont corrigés par la tâche 16b :
 * les tests qui les décrivaient sont des tests normaux, précédés du commentaire « garde D-n ».
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import { forceResponse, loginToAgents, msg, rail, resetMock } from './helpers';

test.beforeEach(async ({ request }) => {
  await resetMock(request);
});

const fr = (key: string, params: Record<string, string | number> = {}) => msg('fr', key, params);
const en = (key: string, params: Record<string, string | number> = {}) => msg('en', key, params);

const SERVER_FR = fr('errors.generic.server');
const reference = (id: string, locale: 'fr' | 'en' = 'fr') => msg(locale, 'errors.generic.reference', { reference: id });

/** Panne 500 : texte contextuel de l'écran et référence de la requête, dans l'alerte de l'emplacement. */
async function expectServerFailure(scope: Locator | Page, id: string, text: string = SERVER_FR): Promise<void> {
  const alert = scope.getByRole('alert').filter({ hasText: reference(id) });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(text);
  await expect(scope.getByText('Erreur interne.')).toHaveCount(0);
}

/**
 * Un refus qui a un emplacement n'est jamais notifié : la région des erreurs (assertive) reste vide et le texte du refus
 * n'est dans aucune notification (une réussite précédente peut encore s'afficher, elle dure 5 s).
 */
async function expectNoNotification(page: Page, refusal?: string): Promise<void> {
  const region = page.getByRole('region', { name: fr('notify.region') });
  await expect(region.locator('[aria-live="assertive"]')).toHaveText('');
  if (refusal) await expect(region).not.toContainText(refusal);
}

const notifications = (page: Page): Locator => page.getByRole('region', { name: fr('notify.region') });

/** Connexion en administrateur de Maison Lumière puis ouverture d'une page de l'espace Organisation. */
async function openOrganisation(page: Page, path: 'entites' | 'utilisateurs' | 'connexions'): Promise<void> {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.goto(`/fr/organisation/${path}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Entités (audit §3, lignes 9 à 13)
// ---------------------------------------------------------------------------------------------------------------------

/** Entité « Boutique Lyon » (identifiant 3 dans le faux moteur) créée par l'écran : seconde entité, requise pour archiver. */
async function createLyon(page: Page): Promise<void> {
  await page.getByRole('button', { name: fr('organisation.entities.new') }).click();
  await page.getByLabel(fr('organisation.entities.nameLabel')).fill('Boutique Lyon');
  await page.getByLabel(fr('organisation.entities.nameLabel')).press('Enter');
  await expect(page.getByRole('cell', { name: 'Boutique Lyon' })).toBeVisible();
}

const entityMenu = (page: Page, name: string): Locator => page.getByRole('button', { name: `${fr('actions.manage')} (${name})` });

test('ligne 9, créer une entité : refus sous le champ, panne avec référence, réussite dans la liste', async ({ page, request }) => {
  await openOrganisation(page, 'entites');
  await page.getByRole('button', { name: fr('organisation.entities.new') }).click();
  const field = page.getByLabel(fr('organisation.entities.nameLabel'));
  await field.fill('Boutique Paris');

  // refus 409 « une entité porte déjà ce nom » : sous le champ, qui reste ouvert, aucune notification
  await forceResponse(request, { route: '/entities', method: 'POST', status: 409, message: 'Une entité porte déjà ce nom.', reason: 'entity.duplicate_name', times: 1 });
  await field.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: fr('errors.reasons.entity.duplicate_name') })).toBeVisible();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expectNoNotification(page);

  // panne 500
  await forceResponse(request, { route: '/entities', method: 'POST', status: 500, requestId: 'req-ent-create', times: 1 });
  await field.press('Enter');
  await expectServerFailure(page.getByRole('row').filter({ has: field }), 'req-ent-create');
  await expectNoNotification(page);

  // réussite : la ligne apparaît, le compteur suit
  await field.fill('Boutique Lyon');
  await field.press('Enter');
  await expect(page.getByRole('cell', { name: 'Boutique Lyon' })).toBeVisible();
  await expect(page.getByText(fr('organisation.entities.activeCount', { count: 2 }))).toBeVisible();
});

test('ligne 10, renommer une entité : refus sous le champ, panne avec référence, réussite dans la ligne', async ({ page, request }) => {
  await openOrganisation(page, 'entites');
  await entityMenu(page, 'Boutique Paris').click();
  await page.getByRole('menuitem', { name: fr('organisation.entities.menu.rename') }).click();
  const field = page.getByLabel(fr('organisation.entities.nameLabel'));
  await field.fill('Boutique Centre');

  await forceResponse(request, { route: '/entities/1', method: 'PATCH', status: 409, message: 'Une entité porte déjà ce nom.', reason: 'entity.duplicate_name', times: 1 });
  await field.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: fr('errors.reasons.entity.duplicate_name') })).toBeVisible();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expectNoNotification(page);

  await forceResponse(request, { route: '/entities/1', method: 'PATCH', status: 500, requestId: 'req-ent-rename', times: 1 });
  await field.press('Enter');
  await expectServerFailure(page.getByRole('row').filter({ has: field }), 'req-ent-rename');

  await field.press('Enter');
  await expect(page.getByRole('cell', { name: 'Boutique Centre' })).toBeVisible();
  await expect(page.getByLabel(fr('organisation.entities.nameLabel'))).toHaveCount(0);
});

test('ligne 11, archiver une entité : refus et panne dans la fenêtre, réussite notifiée et ligne retirée', async ({ page, request }) => {
  await openOrganisation(page, 'entites');
  await createLyon(page);
  await entityMenu(page, 'Boutique Lyon').click();
  await page.getByRole('menuitem', { name: fr('organisation.entities.menu.archive') }).click();
  const dialog = page.getByRole('dialog', { name: fr('organisation.entities.archive.title', { name: 'Boutique Lyon' }) });
  const confirm = dialog.getByRole('button', { name: fr('organisation.entities.archive.confirm') });

  await forceResponse(request, { route: '/entities/3', method: 'PATCH', status: 409, message: "L'organisation doit garder au moins une entité active.", reason: 'entity.last_active', times: 1 });
  await confirm.click();
  await expect(dialog.getByRole('alert')).toHaveText(fr('errors.reasons.entity.last_active'));
  await expectNoNotification(page);

  await forceResponse(request, { route: '/entities/3', method: 'PATCH', status: 500, requestId: 'req-ent-archive', times: 1 });
  await confirm.click();
  await expectServerFailure(dialog, 'req-ent-archive');

  // audit R-19 : la fenêtre se ferme, la ligne sort de la vue, la réussite est dite en nommant l'entité
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(notifications(page)).toContainText(fr('organisation.entities.archived', { name: 'Boutique Lyon' }));
  await expect(page.getByRole('cell', { name: 'Boutique Lyon' })).toHaveCount(0);
});

test('ligne 12, réactiver une entité : refus et panne sous la ligne qui nomme l\'entité, réussite dans la ligne', async ({ page, request }) => {
  await openOrganisation(page, 'entites');
  await createLyon(page);
  await entityMenu(page, 'Boutique Lyon').click();
  await page.getByRole('menuitem', { name: fr('organisation.entities.menu.archive') }).click();
  await page.getByRole('dialog').getByRole('button', { name: fr('organisation.entities.archive.confirm') }).click();
  await expect(page.getByRole('cell', { name: 'Boutique Lyon' })).toHaveCount(0);

  await page.getByRole('checkbox', { name: fr('organisation.entities.showArchived') }).check();
  const row = page.getByRole('row', { name: /Boutique Lyon/ });
  await expect(row.getByText(fr('organisation.entities.archivedPill'))).toBeVisible();

  await forceResponse(request, { route: '/entities/3', method: 'PATCH', status: 409, message: 'Une entité porte déjà ce nom.', reason: 'entity.duplicate_name', times: 1 });
  await row.getByRole('button', { name: fr('organisation.entities.reactivate') }).click();
  const refusal = page.getByRole('alert').filter({ hasText: fr('organisation.rowError', { name: 'Boutique Lyon', message: fr('errors.reasons.entity.duplicate_name') }) });
  await expect(refusal).toBeVisible();
  await expectNoNotification(page);

  await forceResponse(request, { route: '/entities/3', method: 'PATCH', status: 500, requestId: 'req-ent-reactivate', times: 1 });
  await row.getByRole('button', { name: fr('organisation.entities.reactivate') }).click();
  const failure = page.getByRole('alert').filter({ hasText: reference('req-ent-reactivate') });
  await expect(failure).toContainText(fr('organisation.rowError', { name: 'Boutique Lyon', message: SERVER_FR }));

  await row.getByRole('button', { name: fr('organisation.entities.reactivate') }).click();
  await expect(row.getByText(fr('organisation.entities.archivedPill'))).toHaveCount(0);
  await expect(page.getByText(fr('organisation.entities.showArchivedCount', { count: 0 }))).toBeVisible();
});

test('ligne 13, déplacer un agent IA : refus et panne dans la fenêtre, réussite notifiée', async ({ page, request }) => {
  await openOrganisation(page, 'entites');
  await createLyon(page);
  await entityMenu(page, 'Boutique Paris').click();
  await page.getByRole('menuitem', { name: fr('organisation.entities.menu.move') }).click();
  const dialog = page.getByRole('dialog', { name: fr('organisation.entities.move.title') });
  const confirm = dialog.getByRole('button', { name: fr('organisation.entities.move.confirm') });

  await forceResponse(request, { route: '/bots/demo-1', method: 'PATCH', status: 400, message: 'Données invalides.', reason: 'bot.entity_unavailable', details: [{ path: 'entity_id', message: 'Entité introuvable ou archivée.' }], times: 1 });
  await confirm.click();
  await expect(dialog.getByRole('alert')).toHaveText(fr('errors.reasons.bot.entity_unavailable'));
  await expectNoNotification(page);

  await forceResponse(request, { route: '/bots/demo-1', method: 'PATCH', status: 500, requestId: 'req-ent-move', times: 1 });
  await confirm.click();
  await expectServerFailure(dialog, 'req-ent-move');

  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(notifications(page)).toContainText(fr('organisation.entities.moved', { bot: 'Support technique', entity: 'Boutique Lyon' }));
  await expect(page.getByRole('row', { name: /Boutique Lyon/ }).getByText('Support technique')).toBeVisible();
});

// ---------------------------------------------------------------------------------------------------------------------
// Utilisateurs (lignes 14 à 19)
// ---------------------------------------------------------------------------------------------------------------------

const ADVISOR = 'advisor@wabagent.test';
const PENDING = 'nouveau@wabagent.test';
const memberMenu = (page: Page, email: string): Locator => page.getByRole('button', { name: `${fr('actions.manage')} (${email})` });
const drawerOf = (page: Page): Locator => page.getByRole('dialog');

test('ligne 14, inviter : refus et panne dans le tiroir, réussite notifiée', async ({ page, request }) => {
  await openOrganisation(page, 'utilisateurs');
  await page.getByRole('button', { name: fr('organisation.users.invite') }).click();
  const drawer = drawerOf(page);
  await drawer.getByLabel(fr('organisation.users.drawer.emailLabel')).fill('lea@wabagent.test');
  await drawer.getByRole('checkbox', { name: 'Boutique Paris' }).check();
  const send = drawer.getByRole('button', { name: fr('organisation.users.drawer.send') });

  await forceResponse(request, { route: '/invitations', method: 'POST', status: 409, message: "Cette adresse appartient à un compte de la plateforme : contactez le support.", reason: 'invitation.not_invitable', times: 1 });
  await send.click();
  await expect(drawer.getByRole('alert')).toHaveText(fr('errors.reasons.invitation.not_invitable'));
  await expectNoNotification(page, fr('errors.reasons.invitation.not_invitable'));

  await forceResponse(request, { route: '/invitations', method: 'POST', status: 500, requestId: 'req-usr-invite', times: 1 });
  await send.click();
  await expectServerFailure(drawer, 'req-usr-invite');

  await send.click();
  await expect(drawerOf(page)).toHaveCount(0);
  await expect(notifications(page)).toContainText(fr('organisation.users.sent', { email: 'lea@wabagent.test' }));
  await expect(page.getByRole('row', { name: /lea@wabagent\.test/ })).toBeVisible();
});

test('ligne 15, renvoyer une invitation : refus et panne sous la ligne, réussite notifiée', async ({ page, request }) => {
  await openOrganisation(page, 'utilisateurs');
  const row = page.getByRole('row', { name: new RegExp(PENDING.replace('.', '\\.')) });
  const resend = row.getByRole('button', { name: fr('organisation.users.resend') });

  await forceResponse(request, { route: '/invitations/1/resend', method: 'POST', status: 409, message: 'Cette invitation a déjà été acceptée.', reason: 'invitation.already_accepted', times: 1 });
  await resend.click();
  await expect(page.getByRole('alert').filter({ hasText: fr('organisation.rowError', { name: PENDING, message: fr('errors.reasons.invitation.already_accepted') }) })).toBeVisible();
  await expectNoNotification(page, fr('errors.reasons.invitation.already_accepted'));

  await forceResponse(request, { route: '/invitations/1/resend', method: 'POST', status: 500, requestId: 'req-usr-resend', times: 1 });
  await resend.click();
  await expect(page.getByRole('alert').filter({ hasText: reference('req-usr-resend') })).toContainText(fr('organisation.rowError', { name: PENDING, message: SERVER_FR }));

  await resend.click();
  await expect(notifications(page)).toContainText(fr('organisation.users.resent', { email: PENDING }));
});

test('ligne 16, révoquer une invitation : refus et panne dans la fenêtre (réussite notifiée : organisation.spec)', async ({ page, request }) => {
  await openOrganisation(page, 'utilisateurs');
  await memberMenu(page, PENDING).click();
  await page.getByRole('menuitem', { name: fr('organisation.users.menu.revoke') }).click();
  const dialog = page.getByRole('dialog', { name: fr('organisation.users.revoke.title', { email: PENDING }) });
  const confirm = dialog.getByRole('button', { name: fr('organisation.users.revoke.confirm') });

  // revue finale M-8 : refus réel de cette route, 403 du garde de droits (`forbidden()` : « Accès refusé. », sans clé),
  // par exemple des droits retirés entre-temps ; revokeInvitation ne lève jamais invitation.already_accepted.
  await forceResponse(request, { route: '/invitations/1', method: 'DELETE', status: 403, message: 'Accès refusé.', times: 1 });
  await confirm.click();
  await expect(dialog.getByRole('alert')).toHaveText(fr('errors.generic.forbidden'));
  await expect(page.getByText('Accès refusé.')).toHaveCount(0);
  await expectNoNotification(page, fr('errors.generic.forbidden'));

  await forceResponse(request, { route: '/invitations/1', method: 'DELETE', status: 500, requestId: 'req-usr-revoke', times: 1 });
  await confirm.click();
  await expectServerFailure(dialog, 'req-usr-revoke');

  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(notifications(page)).toContainText(fr('organisation.users.revoked', { email: PENDING }));
  await expect(page.getByRole('row', { name: new RegExp(PENDING.replace('.', '\\.')) })).toHaveCount(0);
});

test('ligne 17, modifier les accès : refus et panne dans le tiroir, réussite notifiée', async ({ page, request }) => {
  await openOrganisation(page, 'utilisateurs');
  await memberMenu(page, ADVISOR).click();
  await page.getByRole('menuitem', { name: fr('organisation.users.menu.edit') }).click();
  const drawer = drawerOf(page);
  const save = drawer.getByRole('button', { name: fr('organisation.users.drawer.save') });

  await forceResponse(request, { route: '/users/2/memberships', method: 'PUT', status: 409, message: "L'organisation doit garder au moins un admin.", reason: 'member.last_admin', times: 1 });
  await save.click();
  await expect(drawer.getByRole('alert')).toHaveText(fr('errors.reasons.member.last_admin'));
  await expectNoNotification(page, fr('errors.reasons.member.last_admin'));

  await forceResponse(request, { route: '/users/2/memberships', method: 'PUT', status: 500, requestId: 'req-usr-access', times: 1 });
  await save.click();
  await expectServerFailure(drawer, 'req-usr-access');

  await save.click();
  await expect(drawerOf(page)).toHaveCount(0);
  await expect(notifications(page)).toContainText(fr('organisation.users.accessUpdated', { email: ADVISOR }));
});

test('lignes 18 et 19, suspendre puis réactiver un membre : refus et panne à leur place, réussites visibles', async ({ page, request }) => {
  await openOrganisation(page, 'utilisateurs');
  // ligne 18, suspendre : dans la fenêtre
  await memberMenu(page, ADVISOR).click();
  await page.getByRole('menuitem', { name: fr('organisation.users.menu.suspend') }).click();
  const dialog = page.getByRole('dialog', { name: fr('organisation.users.suspend.title', { email: ADVISOR }) });
  const confirm = dialog.getByRole('button', { name: fr('organisation.users.suspend.confirm') });

  await forceResponse(request, { route: '/users/2', method: 'PATCH', status: 409, message: "L'organisation doit garder au moins un admin.", reason: 'member.last_admin', times: 1 });
  await confirm.click();
  await expect(dialog.getByRole('alert')).toHaveText(fr('errors.reasons.member.last_admin'));
  await expectNoNotification(page, fr('errors.reasons.member.last_admin'));

  await forceResponse(request, { route: '/users/2', method: 'PATCH', status: 500, requestId: 'req-usr-suspend', times: 1 });
  await confirm.click();
  await expectServerFailure(dialog, 'req-usr-suspend');

  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(notifications(page)).toContainText(fr('organisation.users.suspended', { email: ADVISOR }));
  const row = page.getByRole('row', { name: /advisor@wabagent\.test/ });
  await expect(row.getByText(fr('organisation.users.statusSuspended'))).toBeVisible();

  // ligne 19, réactiver : sous la ligne, qui nomme le membre
  await memberMenu(page, ADVISOR).click();
  // le moteur répond 404 (user-admin-service.ts) : le chemin réel passe par WATCHED_STATUSES d'apiFetch
  await forceResponse(request, { route: '/users/2', method: 'PATCH', status: 404, message: 'Utilisateur introuvable.', reason: 'member.not_found', times: 1 });
  await page.getByRole('menuitem', { name: fr('organisation.users.menu.reactivate') }).click();
  await expect(page.getByRole('alert').filter({ hasText: fr('organisation.rowError', { name: ADVISOR, message: fr('errors.reasons.member.not_found') }) })).toBeVisible();
  await expectNoNotification(page, fr('errors.reasons.member.not_found'));

  await memberMenu(page, ADVISOR).click();
  await forceResponse(request, { route: '/users/2', method: 'PATCH', status: 500, requestId: 'req-usr-reactivate', times: 1 });
  await page.getByRole('menuitem', { name: fr('organisation.users.menu.reactivate') }).click();
  await expect(page.getByRole('alert').filter({ hasText: reference('req-usr-reactivate') })).toContainText(fr('organisation.rowError', { name: ADVISOR, message: SERVER_FR }));

  await memberMenu(page, ADVISOR).click();
  await page.getByRole('menuitem', { name: fr('organisation.users.menu.reactivate') }).click();
  await expect(row.getByText(fr('organisation.users.statusActive'))).toBeVisible();
  await expect(row.getByText(fr('organisation.users.statusSuspended'))).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------------------------------
// Connexions (lignes 20 à 28)
// ---------------------------------------------------------------------------------------------------------------------

const ACCOUNT = 'Boutique principale';
const accountMenu = (page: Page): Locator => page.getByRole('button', { name: `${fr('actions.manage')} (${ACCOUNT})` });
const numberRow = (page: Page, shown: string): Locator => page.getByRole('row', { name: new RegExp(`^${shown.replace('+', '\\+')}`) });
const FREE_NUMBER = '+33 6 12 45 78 90';
const TEST_NUMBER = '+1 555 164 9072';
const HOLDER_NUMBER = '+33 1 84 80 12 34';

const fillConnect = async (page: Page, waba: string): Promise<void> => {
  await page.getByLabel(fr('connections.connectFlow.fields.name')).fill('Atelier Rive Gauche');
  await page.getByLabel(fr('connections.connectFlow.fields.wabaId')).fill(waba);
  await page.getByLabel(fr('connections.connectFlow.fields.accessToken')).fill('EAAGtokenvalide-0123456789');
  await page.getByLabel(fr('connections.connectFlow.fields.appSecret')).fill('secretdelappmeta0123');
};

/**
 * Garde du défaut D-1 (tâche 16, corrigé par la tâche 16b) : ces écrans lisaient le refus avec `result.error` (texte du
 * moteur) au lieu de `describeFailure` ; une panne 500 y affichait « Erreur interne. » sans référence de requête, contre
 * l'audit §5.1 (texte contextuel de l'écran et référence) et R-14. Chaque test de panne ci-dessous vérifie le texte
 * contextuel de l'écran, la référence et l'absence du texte du moteur.
 */

test('ligne 20, raccorder un compte : refus à côté du bouton, réussite en écran de résultat (422 : connections.spec)', async ({ page, request }) => {
  await openOrganisation(page, 'connexions');
  await page.getByRole('link', { name: fr('connections.connect') }).click();
  await fillConnect(page, '556677889900112');
  const submit = page.getByRole('button', { name: fr('connections.connectFlow.submit') });

  await forceResponse(request, { route: '/whatsapp-accounts', method: 'POST', status: 409, message: 'Ce compte WhatsApp est déjà raccordé.', reason: 'whatsapp_account.already_connected', times: 1 });
  await submit.click();
  await expect(page.getByRole('alert').filter({ hasText: fr('errors.reasons.whatsapp_account.already_connected') })).toBeVisible();
  await expectNoNotification(page, fr('errors.reasons.whatsapp_account.already_connected'));

  await submit.click();
  await expect(page.getByRole('heading', { name: fr('connections.connectFlow.result.title') })).toBeVisible();
});

// garde D-1 de la tâche 16, audit R-14
test(`ligne 20, raccorder un compte : panne 500 avec texte contextuel et référence`, async ({ page, request }) => {
  await openOrganisation(page, 'connexions');
  await page.getByRole('link', { name: fr('connections.connect') }).click();
  await fillConnect(page, '556677889900112');
  await forceResponse(request, { route: '/whatsapp-accounts', method: 'POST', status: 500, requestId: 'req-cnx-connect', times: 1 });
  await page.getByRole('button', { name: fr('connections.connectFlow.submit') }).click();
  // les pages Organisation n'ont pas de repère `main` : l'alerte est cherchée dans la page
  await expectServerFailure(page, 'req-cnx-connect', fr('connections.connectFlow.errors.failed'));
});

async function openRename(page: Page): Promise<Locator> {
  await accountMenu(page).click();
  await page.getByRole('menuitem', { name: fr('connections.menu.rename') }).click();
  const dialog = page.getByRole('dialog', { name: fr('connections.rename.title') });
  await dialog.getByLabel(fr('connections.rename.label')).fill('Boutique Nord');
  return dialog;
}

test('ligne 21, renommer un compte : refus dans la fenêtre, réussite dans la carte', async ({ page, request }) => {
  await openOrganisation(page, 'connexions');
  const dialog = await openRename(page);
  const save = dialog.getByRole('button', { name: fr('connections.rename.save') });

  await forceResponse(request, { route: '/whatsapp-accounts/1', method: 'PATCH', status: 404, message: 'Compte WhatsApp introuvable.', reason: 'whatsapp_account.not_found', times: 1 });
  await save.click();
  await expect(dialog.getByRole('alert')).toHaveText(fr('errors.reasons.whatsapp_account.not_found'));
  await expectNoNotification(page, fr('errors.reasons.whatsapp_account.not_found'));

  await save.click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Boutique Nord' })).toBeVisible();
});

// garde D-1 de la tâche 16, audit R-14
test(`ligne 21, renommer un compte : panne 500 avec texte contextuel et référence`, async ({ page, request }) => {
  await openOrganisation(page, 'connexions');
  const dialog = await openRename(page);
  await forceResponse(request, { route: '/whatsapp-accounts/1', method: 'PATCH', status: 500, requestId: 'req-cnx-rename', times: 1 });
  await dialog.getByRole('button', { name: fr('connections.rename.save') }).click();
  await expectServerFailure(dialog, 'req-cnx-rename', fr('connections.dialogs.failed'));
});

async function openCredentials(page: Page): Promise<Locator> {
  await accountMenu(page).click();
  await page.getByRole('menuitem', { name: fr('connections.menu.credentials') }).click();
  const dialog = page.getByRole('dialog', { name: fr('connections.credentials.title') });
  await dialog.getByLabel(fr('connections.credentials.wabaId')).fill('104829371625544');
  await dialog.getByLabel(fr('connections.credentials.accessToken')).fill('EAAGtokenvalide-0123456789');
  await dialog.getByLabel(fr('connections.credentials.appSecret')).fill('secretdelappmeta0123');
  return dialog;
}

test('ligne 22, remplacer les identifiants : refus et contrôles dans la fenêtre, résultat en titre', async ({ page, request }) => {
  await openOrganisation(page, 'connexions');
  const dialog = await openCredentials(page);
  const submit = dialog.getByRole('button', { name: fr('connections.credentials.submit'), exact: true });

  await forceResponse(request, { route: '/whatsapp-accounts/1/credentials', method: 'PUT', status: 409, message: 'Pour une autre WABA ou un autre compte CM.com, raccordez un nouveau compte.', reason: 'whatsapp_account.other_provider_account', times: 1 });
  await submit.click();
  await expect(dialog.getByRole('alert')).toHaveText(fr('errors.reasons.whatsapp_account.other_provider_account'));
  await expectNoNotification(page, fr('errors.reasons.whatsapp_account.other_provider_account'));

  await forceResponse(request, {
    route: '/whatsapp-accounts/1/credentials', method: 'PUT', status: 422, message: 'Vérification du compte impossible.', reason: 'whatsapp_account.verification_failed',
    details: [{ path: 'token', message: 'Le jeton est refusé par Meta.' }], times: 1,
  });
  await submit.click();
  await expect(dialog.getByRole('list', { name: fr('connections.checks.listLabel') }).getByText(fr('connections.checks.keys.token'), { exact: true })).toBeVisible();

  await submit.click();
  await expect(dialog.getByRole('status').filter({ hasText: fr('connections.credentials.done') })).toBeVisible();
});

// garde D-1 de la tâche 16, audit R-14
test(`ligne 22, remplacer les identifiants : panne 500 avec texte contextuel et référence`, async ({ page, request }) => {
  await openOrganisation(page, 'connexions');
  const dialog = await openCredentials(page);
  await forceResponse(request, { route: '/whatsapp-accounts/1/credentials', method: 'PUT', status: 500, requestId: 'req-cnx-creds', times: 1 });
  await dialog.getByRole('button', { name: fr('connections.credentials.submit'), exact: true }).click();
  await expectServerFailure(dialog, 'req-cnx-creds', fr('connections.dialogs.failed'));
});

for (const [row, kind, route] of [
  [23, 'verify', 'verify'],
  [24, 'refresh', 'refresh-numbers'],
] as const) {
  const label = kind === 'verify' ? 'vérifier maintenant' : 'rafraîchir les numéros';
  const open = async (page: Page): Promise<Locator> => {
    await accountMenu(page).click();
    await page.getByRole('menuitem', { name: fr(`connections.menu.${kind}`) }).click();
    return page.getByRole('dialog', { name: fr(`connections.${kind}.title`) });
  };

  test(`ligne ${row}, ${label} : refus dans la fenêtre, résultat affiché`, async ({ page, request }) => {
    await openOrganisation(page, 'connexions');
    await forceResponse(request, { route: `/whatsapp-accounts/1/${route}`, method: 'POST', status: 409, message: 'Les identifiants enregistrés de ce compte sont illisibles : retirez ce compte de WABAGENT puis raccordez-le de nouveau.', reason: 'whatsapp_account.secrets_unreadable', times: 1 });
    let dialog = await open(page);
    await expect(dialog.getByRole('alert')).toHaveText(fr('errors.reasons.whatsapp_account.secrets_unreadable'));
    await expectNoNotification(page, fr('errors.reasons.whatsapp_account.secrets_unreadable'));
    await dialog.getByRole('button', { name: fr('connections.dialogs.close') }).click();

    dialog = await open(page);
    if (kind === 'verify') await expect(dialog.getByRole('status').filter({ hasText: fr('connections.verify.verified') })).toBeVisible();
    else await expect(dialog.getByText(fr('connections.inventory.summary', { added: 0, removed: 0 }))).toBeVisible();
  });

  // garde D-1 de la tâche 16, audit R-14
  test(`ligne ${row}, ${label} : panne 500 avec texte contextuel et référence`, async ({ page, request }) => {
    await openOrganisation(page, 'connexions');
    await forceResponse(request, { route: `/whatsapp-accounts/1/${route}`, method: 'POST', status: 500, requestId: `req-cnx-${kind}`, times: 1 });
    const dialog = await open(page);
    await expectServerFailure(dialog, `req-cnx-${kind}`, fr('connections.dialogs.failed'));
  });
}

// audit décisions B7 : la fenêtre « Rafraîchir les numéros » dit la cause connue ; « Réessayez » seulement pour une panne passagère
test('ligne 24, rafraîchir les numéros : jeton refusé, cause et action « Remplacer les identifiants » ; panne passagère, « Réessayez »', async ({ page, request }) => {
  await openOrganisation(page, 'connexions');
  const open = async (): Promise<Locator> => {
    await accountMenu(page).click();
    await page.getByRole('menuitem', { name: fr('connections.menu.refresh') }).click();
    return page.getByRole('dialog', { name: fr('connections.refresh.title') });
  };
  const refusal = (reason: string, message: string) => ({
    route: '/whatsapp-accounts/1/refresh-numbers', method: 'POST' as const, status: 422, code: 'WA_VALIDATION_FAILED',
    message, reason, details: [{ path: 'numbers', message }], times: 1,
  });

  await forceResponse(request, refusal('whatsapp_account.listing_unavailable', 'Meta injoignable'));
  let dialog = await open();
  await expect(dialog.getByRole('alert')).toHaveText(fr('errors.reasons.whatsapp_account.listing_unavailable'));
  await expectNoNotification(page, fr('errors.reasons.whatsapp_account.listing_unavailable'));
  await dialog.getByRole('button', { name: fr('connections.dialogs.close') }).click();

  await forceResponse(request, refusal('whatsapp_account.listing_token_invalid', 'Jeton refusé par Meta'));
  dialog = await open();
  const alert = dialog.getByRole('alert');
  await expect(alert).toContainText(fr('connections.refresh.tokenRefused', { provider: 'Meta' }));
  await expect(alert).not.toContainText('Réessayez');
  await alert.getByRole('button', { name: fr('connections.menu.credentials') }).click();
  await expect(page.getByRole('dialog', { name: fr('connections.credentials.title') })).toBeVisible();
  await expect(page.getByRole('dialog', { name: fr('connections.refresh.title') })).toHaveCount(0);
});

test('ligne 25, retirer un compte : refus nommant les agents IA et panne avec référence dans la fenêtre (réussite notifiée : connections.spec)', async ({ page, request }) => {
  await openOrganisation(page, 'connexions');
  await accountMenu(page).click();
  await page.getByRole('menuitem', { name: fr('connections.menu.disconnect') }).click();
  const dialog = page.getByRole('dialog', { name: fr('connections.disconnect.title', { name: ACCOUNT }) });
  const confirm = dialog.getByRole('button', { name: fr('connections.disconnect.confirm') });

  // refus réel du faux moteur : l'agent IA actif tient le compte
  await confirm.click();
  await expect(dialog.getByRole('alert')).toHaveText(fr('errors.reasons.whatsapp_account.in_use'));
  await expect(dialog.getByRole('list', { name: fr('connections.disconnect.botsLabel') }).getByRole('listitem')).toHaveText(['Support technique']);
  await expectNoNotification(page, fr('errors.reasons.whatsapp_account.in_use'));

  await forceResponse(request, { route: '/whatsapp-accounts/1/disconnect', method: 'POST', status: 500, requestId: 'req-cnx-disconnect', times: 1 });
  await confirm.click();
  await expectServerFailure(dialog, 'req-cnx-disconnect');
});

async function openUnmark(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: `${fr('actions.manage')} (${TEST_NUMBER})` }).click();
  await page.getByRole('menuitem', { name: fr('connections.menu.unmarkTest') }).click();
  return page.getByRole('dialog', { name: fr('connections.testFlag.unmarkTitle', { number: TEST_NUMBER }) });
}

test('ligne 26, marquer un numéro de test : refus dans la fenêtre, réussite dans la ligne', async ({ page, request }) => {
  await openOrganisation(page, 'connexions');
  const dialog = await openUnmark(page);
  const confirm = dialog.getByRole('button', { name: fr('connections.testFlag.unmarkConfirm') });

  await forceResponse(request, { route: '/whatsapp-accounts/1/numbers/3', method: 'PATCH', status: 404, message: 'Numéro WhatsApp introuvable.', reason: 'whatsapp_account.number_not_found', times: 1 });
  await confirm.click();
  await expect(dialog.getByRole('alert')).toHaveText(fr('errors.reasons.whatsapp_account.number_not_found'));
  await expectNoNotification(page, fr('errors.reasons.whatsapp_account.number_not_found'));

  await confirm.click();
  await expect(dialog).toHaveCount(0);
  // le badge « Numéro de test » ne subsiste que par le nom d'affichage du numéro
  await expect(numberRow(page, TEST_NUMBER).getByText(fr('connections.numbers.testBadge'), { exact: true })).toHaveCount(1);
});

// garde D-1 de la tâche 16, audit R-14
test(`ligne 26, marquer un numéro de test : panne 500 avec texte contextuel et référence`, async ({ page, request }) => {
  await openOrganisation(page, 'connexions');
  const dialog = await openUnmark(page);
  await forceResponse(request, { route: '/whatsapp-accounts/1/numbers/3', method: 'PATCH', status: 500, requestId: 'req-cnx-flag', times: 1 });
  await dialog.getByRole('button', { name: fr('connections.testFlag.unmarkConfirm') }).click();
  await expectServerFailure(dialog, 'req-cnx-flag', fr('connections.dialogs.failed'));
});

const HOLDER_CHANGED = {
  status: 409, message: 'Ce numéro a changé depuis votre lecture : vérifiez la liste.', reason: 'assign.holder_changed',
  details: [{ path: 'expected_bot_id', message: 'Ce numéro a changé depuis votre lecture : vérifiez la liste.' }],
} as const;

async function openAssign(page: Page): Promise<Locator> {
  await numberRow(page, FREE_NUMBER).getByRole('button', { name: fr('connections.numbers.assign') }).click();
  const dialog = page.getByRole('dialog', { name: fr('connections.assign.title') });
  await dialog.getByRole('radio', { name: /Accueil boutique/ }).check();
  return dialog;
}

test('ligne 27, brancher un numéro (Connexions) : refus « numéro changé » dans la fenêtre (réussite : connections.spec)', async ({ page, request }) => {
  await openOrganisation(page, 'connexions');
  const dialog = await openAssign(page);
  await forceResponse(request, { route: '/bots/demo-3/number', method: 'PUT', ...HOLDER_CHANGED, times: 1 });
  await dialog.getByRole('button', { name: fr('connections.assign.submit'), exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText(fr('errors.reasons.assign.holder_changed'));
  await expectNoNotification(page, fr('errors.reasons.assign.holder_changed'));
  // la demande ne vaut plus : le choix est à refaire, puis le branchement réussit
  await dialog.getByRole('radio', { name: /Accueil boutique/ }).check();
  await dialog.getByRole('button', { name: fr('connections.assign.submit'), exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(numberRow(page, FREE_NUMBER).getByRole('link', { name: /Accueil boutique/ })).toBeVisible();
});

// garde D-1 de la tâche 16, audit R-14
test(`ligne 27, brancher un numéro (Connexions) : panne 500 avec texte contextuel et référence`, async ({ page, request }) => {
  await openOrganisation(page, 'connexions');
  const dialog = await openAssign(page);
  await forceResponse(request, { route: '/bots/demo-3/number', method: 'PUT', status: 500, requestId: 'req-cnx-assign', times: 1 });
  await dialog.getByRole('button', { name: fr('connections.assign.submit'), exact: true }).click();
  await expectServerFailure(dialog, 'req-cnx-assign', fr('connections.dialogs.failed'));
});

async function openUnassign(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: `${fr('actions.manage')} (${HOLDER_NUMBER})` }).click();
  await page.getByRole('menuitem', { name: fr('connections.menu.unassign') }).click();
  return page.getByRole('dialog', { name: fr('connections.unassign.title', { bot: 'Support technique' }) });
}

test('ligne 28, débrancher (Connexions) : refus « numéro changé » dans la fenêtre, réussite dans la ligne', async ({ page, request }) => {
  await openOrganisation(page, 'connexions');
  let dialog = await openUnassign(page);
  await forceResponse(request, { route: '/bots/demo-1/number/unassign', method: 'POST', ...HOLDER_CHANGED, times: 1 });
  await dialog.getByRole('button', { name: fr('connections.unassign.confirm') }).click();
  await expect(dialog.getByRole('alert')).toHaveText(fr('errors.reasons.assign.holder_changed'));
  await expectNoNotification(page, fr('errors.reasons.assign.holder_changed'));
  await dialog.getByRole('button', { name: fr('connections.dialogs.close') }).click();

  dialog = await openUnassign(page);
  await dialog.getByRole('button', { name: fr('connections.unassign.confirm') }).click();
  await expect(dialog).toHaveCount(0);
  await expect(numberRow(page, HOLDER_NUMBER).getByText(fr('connections.numbers.free'), { exact: true })).toBeVisible();
});

// décision François A9 : un agent IA ouvert à tous dont on débranche le numéro passe en Désactivé, avec son motif
test('ligne 28, débrancher un agent IA ouvert à tous : la fenêtre annonce « Désactivé », le panneau Statut dit le motif', async ({ page }) => {
  await openOrganisation(page, 'connexions');
  const dialog = await openUnassign(page);
  await expect(dialog).toContainText(fr('connections.unassign.toPaused', { bot: 'Support technique' }));
  await expect(dialog).not.toContainText('Brouillon');
  await dialog.getByRole('button', { name: fr('connections.unassign.confirm') }).click();
  await expect(dialog).toHaveCount(0);
  await page.goto('/fr/agents/demo-1');
  const panel = page.getByRole('region', { name: fr('agentStatus.title') });
  await expect(panel.getByText(fr('agents.status.paused'), { exact: true })).toBeVisible();
  await expect(panel.getByText(fr('agentStatus.pauseReasons.number_unassigned'))).toBeVisible();
  await expect(panel.getByText('number_unassigned')).toHaveCount(0);
});

// garde D-1 de la tâche 16, audit R-14
test(`ligne 28, débrancher (Connexions) : panne 500 avec texte contextuel et référence`, async ({ page, request }) => {
  await openOrganisation(page, 'connexions');
  const dialog = await openUnassign(page);
  await forceResponse(request, { route: '/bots/demo-1/number/unassign', method: 'POST', status: 500, requestId: 'req-cnx-unassign', times: 1 });
  await dialog.getByRole('button', { name: fr('connections.unassign.confirm') }).click();
  await expectServerFailure(dialog, 'req-cnx-unassign', fr('connections.dialogs.failed'));
});

// ---------------------------------------------------------------------------------------------------------------------
// Assistant de création et page de l'agent IA (lignes 29 à 34)
// ---------------------------------------------------------------------------------------------------------------------

// Ligne 29 (créer l'agent IA, étape 2) : refus de l'entité et de la langue, panne avec référence et réussite sont dans onboarding.spec.ts.

/** Assistant jusqu'à l'étape 5 « Activer » sur le numéro de test (liste d'accès facultative, bouton « Activer »). */
async function reachActivateStep(page: Page): Promise<void> {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.getByRole('link', { name: fr('agents.create') }).click();
  await page.getByLabel(fr('wizard.name')).fill('Assistant Essai');
  await page.getByRole('button', { name: `${fr('wizard.continue')} →` }).click();
  await page.getByLabel(fr('wizard.role')).fill('Conseiller commercial');
  await page.getByRole('button', { name: `${fr('wizard.createAndTest')} →` }).click();
  await expect(page.getByRole('heading', { name: fr('simulate.title') })).toBeVisible();
  await page.getByRole('button', { name: fr('simulate.next') }).click();
  await expect(page.getByRole('heading', { name: fr('wizard.number.title') })).toBeVisible();
  await page.getByRole('radiogroup', { name: fr('numberPicker.legend') }).getByRole('radio', { name: /\+1 555 164 9072/ }).check({ force: true });
  await page.getByRole('button', { name: fr('wizard.continue') }).click();
  await expect(page.getByRole('heading', { name: fr('wizard.activate.title') })).toBeVisible();
}

test('ligne 30, activer (assistant) : refus du moteur sous le bouton, réussite en écran de confirmation (réussite : activation.spec)', async ({ page, request }) => {
  await reachActivateStep(page);
  await forceResponse(request, { route: '/bots/assistant-essai/activate', method: 'POST', status: 409, message: "Le compte WhatsApp de ce numéro n'est pas connecté.", reason: 'transition.account_not_connected', times: 1 });
  await page.getByRole('button', { name: fr('wizard.activate.activateTest'), exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: fr('errors.reasons.transition.account_not_connected') })).toBeVisible();
  await expect(page.getByRole('heading', { name: fr('wizard.activate.title') })).toBeVisible();
  await expectNoNotification(page, fr('errors.reasons.transition.account_not_connected'));

  await page.getByRole('button', { name: fr('wizard.activate.activateTest'), exact: true }).click();
  await expect(page.getByRole('heading', { name: /Assistant Essai/ })).toBeVisible();
});

// garde D-1 de la tâche 16, audit R-14
test(`ligne 30, activer (assistant) : panne 500 avec texte contextuel et référence`, async ({ page, request }) => {
  await reachActivateStep(page);
  await forceResponse(request, { route: '/bots/assistant-essai/activate', method: 'POST', status: 500, requestId: 'req-agt-activate', times: 1 });
  await page.getByRole('button', { name: fr('wizard.activate.activateTest'), exact: true }).click();
  await expectServerFailure(page.locator('main'), 'req-agt-activate', fr('wizard.activate.activateFailed'));
});

async function openAgent(page: Page): Promise<void> {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.getByText('Support technique').click();
  await page.waitForURL('**/agents/demo-1');
}

const statusRegion = (page: Page): Locator => page.getByRole('region', { name: fr('agentStatus.title') });
const numberRegion = (page: Page): Locator => page.getByRole('region', { name: fr('agentNumber.title') });
const listRegion = (page: Page): Locator => page.getByRole('region', { name: fr('agentAllowlist.title') });

async function deactivate(page: Page): Promise<void> {
  await statusRegion(page).getByRole('button', { name: fr('agentStatus.actions.deactivate') }).click();
  await page.getByRole('dialog').getByRole('button', { name: fr('agentStatus.confirm.deactivate.confirm') }).click();
}

test('ligne 31, changer le statut : refus dans le panneau, réussite dans la pastille, relecture en échec dite sans fausse erreur', async ({ page, request }) => {
  await openAgent(page);
  const status = statusRegion(page);

  await forceResponse(request, { route: '/bots/demo-1/status', method: 'PUT', status: 409, message: 'Changement de statut impossible depuis le statut actuel.', reason: 'transition.invalid_transition', times: 1 });
  await deactivate(page);
  await expect(status.getByRole('alert')).toHaveText(fr('errors.reasons.transition.invalid_transition'));
  await expectNoNotification(page, fr('errors.reasons.transition.invalid_transition'));

  // audit R-19 : l'écriture réussit, la relecture de la page échoue : « Modification enregistrée », pas un échec
  await forceResponse(request, { route: '/bots/demo-1', method: 'GET', status: 500, times: 1 });
  await deactivate(page);
  await expect(page.getByText(fr('feedback.stale'))).toBeVisible();
  // le panneau montre encore la dernière lecture ; « Réessayer » relit la page et la pastille suit
  await page.getByRole('button', { name: fr('common.retry') }).click();
  await expect(status.getByText(fr('agents.status.paused'), { exact: true })).toBeVisible();
  await expect(page.getByText(fr('feedback.stale'))).toHaveCount(0);
});

// garde D-1 de la tâche 16, audit R-14
test(`ligne 31, changer le statut : panne 500 avec texte contextuel et référence`, async ({ page, request }) => {
  await openAgent(page);
  await forceResponse(request, { route: '/bots/demo-1/status', method: 'PUT', status: 500, requestId: 'req-agt-status', times: 1 });
  await deactivate(page);
  await expectServerFailure(statusRegion(page), 'req-agt-status', fr('agentStatus.failed'));
});

async function openChangeNumber(page: Page): Promise<Locator> {
  await numberRegion(page).getByRole('button', { name: fr('agentNumber.change') }).click();
  const dialog = page.getByRole('dialog', { name: fr('agentNumber.dialog.titleChange') });
  await dialog.getByRole('radio', { name: /\+33 6 12 45 78 90/ }).check({ force: true });
  return dialog;
}

test('ligne 32, brancher ou changer le numéro (page de l\'agent IA) : refus dans la fenêtre, réussite dans le panneau, relecture en échec dite', async ({ page, request }) => {
  await openAgent(page);
  let dialog = await openChangeNumber(page);
  await forceResponse(request, { route: '/bots/demo-1/number', method: 'PUT', ...HOLDER_CHANGED, times: 1 });
  await dialog.getByRole('button', { name: fr('agentNumber.dialog.submit') }).click();
  await expect(dialog.getByRole('alert')).toHaveText(fr('errors.reasons.assign.holder_changed'));
  await expectNoNotification(page, fr('errors.reasons.assign.holder_changed'));

  // audit R-19 : branchement accepté, relecture de la page en échec
  await dialog.getByRole('radio', { name: /\+33 6 12 45 78 90/ }).check({ force: true });
  await forceResponse(request, { route: '/bots/demo-1', method: 'GET', status: 500, times: 1 });
  await dialog.getByRole('button', { name: fr('agentNumber.dialog.submit') }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(fr('feedback.stale'))).toBeVisible();

  // la relecture réussie montre le nouveau numéro dans le panneau
  await page.getByRole('button', { name: fr('common.retry') }).click();
  await expect(numberRegion(page)).toContainText('+33 6 12 45 78 90');
  dialog = page.getByRole('dialog');
  await expect(dialog).toHaveCount(0);
});

// garde D-1 de la tâche 16, audit R-14
test(`ligne 32, brancher ou changer le numéro (page de l'agent IA) : panne 500 avec texte contextuel et référence`, async ({ page, request }) => {
  await openAgent(page);
  const dialog = await openChangeNumber(page);
  await forceResponse(request, { route: '/bots/demo-1/number', method: 'PUT', status: 500, requestId: 'req-agt-number', times: 1 });
  await dialog.getByRole('button', { name: fr('agentNumber.dialog.submit') }).click();
  await expectServerFailure(dialog, 'req-agt-number', fr('connections.dialogs.failed'));
});

async function fillAllowlist(page: Page): Promise<void> {
  await page.getByLabel(fr('allowlist.label')).fill('+33611223344');
  await listRegion(page).getByRole('button', { name: fr('allowlist.add'), exact: true }).click();
}

test('ligne 33, enregistrer la liste d\'accès limité : refus sous l\'entrée refusée (réussite : agent-space.spec)', async ({ page, request }) => {
  await openAgent(page);
  await fillAllowlist(page);
  await forceResponse(request, {
    route: '/bots/demo-1/allowlist', method: 'PUT', status: 400, message: 'Données invalides.', reason: 'allowlist.invalid_entry',
    details: [{ path: 'entries.0', message: fr('errors.reasons.allowlist.invalid_entry') }], times: 1,
  });
  await listRegion(page).getByRole('button', { name: fr('agentAllowlist.save') }).click();
  await expect(listRegion(page).getByText(fr('errors.reasons.allowlist.invalid_entry'))).toBeVisible();
  await expect(listRegion(page).getByText(fr('agentAllowlist.saved'))).toHaveCount(0);
  await expectNoNotification(page, fr('errors.reasons.allowlist.invalid_entry'));

  await listRegion(page).getByRole('button', { name: fr('agentAllowlist.save') }).click();
  await expect(listRegion(page).getByText(fr('agentAllowlist.saved'))).toBeVisible();
});

// garde D-1 de la tâche 16, audit R-14
test(`ligne 33, enregistrer la liste d'accès limité : panne 500 avec texte contextuel et référence`, async ({ page, request }) => {
  await openAgent(page);
  await fillAllowlist(page);
  await forceResponse(request, { route: '/bots/demo-1/allowlist', method: 'PUT', status: 500, requestId: 'req-agt-list', times: 1 });
  await listRegion(page).getByRole('button', { name: fr('agentAllowlist.save') }).click();
  await expectServerFailure(listRegion(page), 'req-agt-list', fr('agentAllowlist.failed'));
});

const SIMULATE = '/bots/demo-1/simulate';

async function openSimulator(page: Page): Promise<Locator> {
  await openAgent(page);
  await page.getByRole('button', { name: '▶ Simuler' }).click();
  return page.getByPlaceholder(fr('simulate.placeholder'));
}

test('ligne 34, simulateur : panne avec texte contextuel et référence, message gardé, réponse dans le fil', async ({ page, request }) => {
  const box = await openSimulator(page);
  await forceResponse(request, { route: SIMULATE, method: 'POST', status: 500, requestId: 'req-agt-simulate', times: 1 });
  await box.fill('Bonjour');
  await box.press('Enter');
  await expect(page.getByText(fr('simulate.notSent'))).toBeVisible();
  await expect(box).toHaveValue('Bonjour');
  await expectServerFailure(page, 'req-agt-simulate');
  await expectNoNotification(page);

  await page.getByRole('button', { name: fr('simulate.resend') }).click();
  // réponse fabriquée par le faux moteur (mock-engine.ts), pas un texte de l'interface
  await expect(page.getByText('Réponse simulée à : Bonjour')).toBeVisible();
  await expect(page.getByText(fr('simulate.notSent'))).toHaveCount(0);
});

test('ligne 34, simulateur : agent IA supprimé, « Cet agent IA n\'existe plus. » sans renvoi possible', async ({ page, request }) => {
  const box = await openSimulator(page);
  await forceResponse(request, { route: SIMULATE, method: 'POST', status: 404, message: 'Agent IA introuvable.', reason: 'bot.not_found', times: 1 });
  await box.fill('Bonjour');
  await box.press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: fr('simulate.gone') })).toBeVisible();
  await expect(page.getByText(fr('simulate.notSent'))).toBeVisible();
  await expect(page.getByRole('button', { name: fr('simulate.resend') })).toHaveCount(0);
  await expectNoNotification(page, fr('simulate.gone'));
});

// ---------------------------------------------------------------------------------------------------------------------
// Authentification et session (lignes 1 à 8)
// ---------------------------------------------------------------------------------------------------------------------

// Ligne 1 (se connecter) : refus, panne et redirection sont dans login.spec.ts. Ligne 7 (changer d'organisation) : refus
// « suspendue » et panne dans two-tabs.spec.ts, réussite dans login.spec.ts.

const SAVE_ERROR_FR = fr('auth.saveError');
/**
 * Garde du défaut D-3 (tâche 16, corrigé par la tâche 16b) : ces formulaires publics (mot de passe oublié, nouveau mot de
 * passe, invitation d'un compte neuf) affichaient le texte contextuel sans la référence de la requête (audit §5.1, R-14).
 */

test('ligne 2, mot de passe oublié : panne avec texte contextuel, puis confirmation (réussite : password-reset.spec)', async ({ page, request }) => {
  await page.goto('/fr/forgot-password');
  await page.getByLabel(fr('auth.email')).fill('demo@wabagent.test');
  await forceResponse(request, { route: '/auth/forgot-password', method: 'POST', status: 500, requestId: 'req-auth-forgot', times: 1 });
  await page.getByRole('button', { name: fr('auth.forgot.submit') }).click();
  await expect(page.getByRole('alert').filter({ hasText: fr('auth.forgot.sendError') })).toBeVisible();
  await expect(page.getByText('Erreur interne.')).toHaveCount(0);

  await page.getByRole('button', { name: fr('auth.forgot.submit') }).click();
  await expect(page.getByRole('status')).toContainText(fr('auth.forgot.sent'));
});

// garde D-3 de la tâche 16, audit R-14
test(`ligne 2, mot de passe oublié : la panne montre la référence`, async ({ page, request }) => {
  await page.goto('/fr/forgot-password');
  await page.getByLabel(fr('auth.email')).fill('demo@wabagent.test');
  await forceResponse(request, { route: '/auth/forgot-password', method: 'POST', status: 500, requestId: 'req-auth-forgot', times: 1 });
  await page.getByRole('button', { name: fr('auth.forgot.submit') }).click();
  await expectServerFailure(page, 'req-auth-forgot', fr('auth.forgot.sendError'));
});

test('ligne 3, nouveau mot de passe : panne avec texte contextuel, puis retour à la connexion (refus et réussite : password-reset.spec)', async ({ page, request }) => {
  await page.goto('/fr/reset-password?token=reset-ok');
  await page.getByLabel(fr('auth.reset.password')).fill('nouveaumdp123');
  await forceResponse(request, { route: '/auth/reset-password', method: 'POST', status: 500, requestId: 'req-auth-reset', times: 1 });
  await page.getByRole('button', { name: fr('auth.reset.submit') }).click();
  await expect(page.getByRole('alert').filter({ hasText: SAVE_ERROR_FR })).toBeVisible();
  await expect(page.getByText('Erreur interne.')).toHaveCount(0);

  await page.getByRole('button', { name: fr('auth.reset.submit') }).click();
  await expect(page).toHaveURL(/\/fr\/login\?reset=1$/);
});

// garde D-3 de la tâche 16, audit R-14
test(`ligne 3, nouveau mot de passe : la panne montre la référence`, async ({ page, request }) => {
  await page.goto('/fr/reset-password?token=reset-ok');
  await page.getByLabel(fr('auth.reset.password')).fill('nouveaumdp123');
  await forceResponse(request, { route: '/auth/reset-password', method: 'POST', status: 500, requestId: 'req-auth-reset', times: 1 });
  await page.getByRole('button', { name: fr('auth.reset.submit') }).click();
  await expectServerFailure(page, 'req-auth-reset', SAVE_ERROR_FR);
});

test('ligne 4, accepter une invitation (compte neuf) : lien refusé et panne avec texte contextuel, puis arrivée (mot de passe court : accept-invite.spec)', async ({ page, request }) => {
  await page.goto('/fr/accept-invite?token=invite-new');
  await page.getByLabel(fr('auth.password')).fill('motdepasse12');
  const submit = page.getByRole('button', { name: fr('auth.acceptSubmit') });

  await forceResponse(request, { route: '/auth/accept-invite', method: 'POST', status: 401, message: 'Invitation invalide ou expirée.', reason: 'auth.invalid_invitation', times: 1 });
  await submit.click();
  await expect(page.getByRole('alert').filter({ hasText: fr('errors.reasons.auth.invalid_invitation') })).toBeVisible();

  await forceResponse(request, { route: '/auth/accept-invite', method: 'POST', status: 500, requestId: 'req-auth-accept-new', times: 1 });
  await submit.click();
  await expect(page.getByRole('alert').filter({ hasText: SAVE_ERROR_FR })).toBeVisible();
  await expect(page.getByText('Erreur interne.')).toHaveCount(0);

  await submit.click();
  await expect(page.getByText(fr('agents.welcome', { org: 'Maison Lumière' }))).toBeVisible();
});

// garde D-3 de la tâche 16, audit R-14
test(`ligne 4, accepter une invitation (compte neuf) : la panne montre la référence`, async ({ page, request }) => {
  await page.goto('/fr/accept-invite?token=invite-new');
  await page.getByLabel(fr('auth.password')).fill('motdepasse12');
  await forceResponse(request, { route: '/auth/accept-invite', method: 'POST', status: 500, requestId: 'req-auth-accept-new', times: 1 });
  await page.getByRole('button', { name: fr('auth.acceptSubmit') }).click();
  await expectServerFailure(page, 'req-auth-accept-new', SAVE_ERROR_FR);
});

test('ligne 5, accepter une invitation (compte existant) : refus et panne avec référence, puis bienvenue', async ({ page, request }) => {
  await page.goto('/fr/accept-invite?token=invite-existing');
  await page.getByLabel(fr('auth.email')).fill('advisor@wabagent.test');
  await page.getByLabel(fr('auth.password')).fill('motdepasse12');
  await page.getByRole('button', { name: fr('auth.submit') }).click();
  const accept = page.getByRole('button', { name: fr('auth.invite.accept') });

  // un 401 est rejoué une fois par le BFF après un renouvellement de session : deux réponses forcées
  await forceResponse(request, { route: '/auth/invitations/accept', method: 'POST', status: 401, message: 'Invitation invalide ou expirée.', reason: 'auth.invalid_invitation', times: 2 });
  await accept.click();
  await expect(page.getByRole('alert').filter({ hasText: fr('errors.reasons.auth.invalid_invitation') })).toBeVisible();

  await forceResponse(request, { route: '/auth/invitations/accept', method: 'POST', status: 500, requestId: 'req-auth-accept-old', times: 1 });
  await accept.click();
  await expectServerFailure(page, 'req-auth-accept-old', SAVE_ERROR_FR);

  await accept.click();
  await expect(page.getByText(fr('agents.welcome', { org: 'Atelier Nord' }))).toBeVisible();
});

test('ligne 6, changer le mot de passe : panne avec texte contextuel et référence, puis message de réussite (refus : password-reset.spec)', async ({ page, request }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await page.goto('/fr/account/securite');
  await page.getByLabel(fr('account.security.current')).fill('motdepasse12');
  await page.getByLabel(fr('account.security.new')).fill('nouveaumdp123');
  await forceResponse(request, { route: '/auth/change-password', method: 'POST', status: 500, requestId: 'req-auth-password', times: 1 });
  await page.getByRole('button', { name: fr('account.security.submit') }).click();
  await expectServerFailure(page, 'req-auth-password', fr('common.error'));

  await page.getByRole('button', { name: fr('account.security.submit') }).click();
  await expect(page.getByRole('status')).toContainText(fr('account.security.success'));
});

test('ligne 8, se déconnecter : la connexion est quittée même quand le moteur échoue (aucun refus possible, la redirection est la réussite)', async ({ page, request }) => {
  await loginToAgents(page, 'demo@wabagent.test');
  await forceResponse(request, { route: '/auth/logout', method: 'POST', status: 500, requestId: 'req-auth-logout', times: 1 });
  // Le menu de l'avatar n'existe plus : « Se déconnecter » est en bas de la colonne du compte (spec 11).
  await rail(page).getByRole('link', { name: 'Compte, demo@wabagent.test' }).click();
  await page.getByRole('complementary').getByRole('button', { name: fr('account.rail.logout') }).click();
  await expect(page).toHaveURL(/\/fr\/login$/);
  await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------------------------------
// Interface en anglais : un refus à clé s'affiche en anglais, jamais avec le texte français du moteur (audit R-15)
// ---------------------------------------------------------------------------------------------------------------------

async function openEnglish(page: Page, path: 'entites' | 'utilisateurs' | 'connexions'): Promise<void> {
  await page.goto('/en/login');
  await page.getByLabel(en('auth.email')).fill('demo@wabagent.test');
  await page.getByLabel(en('auth.password')).fill('motdepasse12');
  await page.getByRole('button', { name: en('auth.submit') }).click();
  await expect(page.getByRole('heading', { name: en('agents.title') })).toBeVisible();
  await page.goto(`/en/organisation/${path}`);
}

/** Le refus est dans le texte anglais de sa clé, le texte français du moteur n'est nulle part dans la page. */
async function expectEnglishRefusal(page: Page, scope: Locator, key: string, engineFrench: string): Promise<void> {
  await expect(scope.getByText(en(`errors.reasons.${key}`))).toBeVisible();
  await expect(page.getByText(engineFrench)).toHaveCount(0);
}

test('anglais, entity.duplicate_name : créer une entité refuse en anglais sous le champ', async ({ page, request }) => {
  await openEnglish(page, 'entites');
  await page.getByRole('button', { name: en('organisation.entities.new') }).click();
  const field = page.getByLabel(en('organisation.entities.nameLabel'));
  await field.fill('Boutique Paris');
  await forceResponse(request, { route: '/entities', method: 'POST', status: 409, message: 'Une entité porte déjà ce nom.', reason: 'entity.duplicate_name', times: 1 });
  await field.press('Enter');
  await expectEnglishRefusal(page, page.getByRole('alert'), 'entity.duplicate_name', 'Une entité porte déjà ce nom.');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
});

test('anglais, member.last_admin : suspendre un membre refuse en anglais dans la fenêtre', async ({ page, request }) => {
  await openEnglish(page, 'utilisateurs');
  await page.getByRole('button', { name: `${en('actions.manage')} (${ADVISOR})` }).click();
  await page.getByRole('menuitem', { name: en('organisation.users.menu.suspend') }).click();
  const dialog = page.getByRole('dialog', { name: en('organisation.users.suspend.title', { email: ADVISOR }) });
  await forceResponse(request, { route: '/users/2', method: 'PATCH', status: 409, message: "L'organisation doit garder au moins un admin.", reason: 'member.last_admin', times: 1 });
  await dialog.getByRole('button', { name: en('organisation.users.suspend.confirm') }).click();
  await expectEnglishRefusal(page, dialog.getByRole('alert'), 'member.last_admin', "L'organisation doit garder au moins un admin.");
});

test('anglais, invitation.not_invitable : inviter refuse en anglais dans le tiroir', async ({ page, request }) => {
  await openEnglish(page, 'utilisateurs');
  await page.getByRole('button', { name: en('organisation.users.invite') }).click();
  const drawer = page.getByRole('dialog');
  await drawer.getByLabel(en('organisation.users.drawer.emailLabel')).fill('lea@wabagent.test');
  await drawer.getByRole('checkbox', { name: 'Boutique Paris' }).check();
  await forceResponse(request, { route: '/invitations', method: 'POST', status: 409, message: 'Cette adresse appartient à un compte de la plateforme : contactez le support.', reason: 'invitation.not_invitable', times: 1 });
  await drawer.getByRole('button', { name: en('organisation.users.drawer.send') }).click();
  await expectEnglishRefusal(page, drawer.getByRole('alert'), 'invitation.not_invitable', 'Cette adresse appartient à un compte de la plateforme : contactez le support.');
});

/**
 * Garde du défaut D-2 (tâche 16, corrigé par la tâche 16b) : les fenêtres de Connexions et les panneaux de la page de
 * l'agent IA affichaient `result.error`, le texte français du moteur, au lieu du texte de la clé : l'interface anglaise
 * montrait du français et, en français, un texte du moteur qui divergeait de celui des clés
 * (`whatsapp_account.disconnected` : « déconnecté » au lieu de « retiré de WABAGENT »).
 */

// garde D-2 de la tâche 16, audit R-15
test(`anglais, assign.holder_changed : brancher un numéro (Connexions) refuse en anglais`, async ({ page, request }) => {
  await openEnglish(page, 'connexions');
  await numberRow(page, FREE_NUMBER).getByRole('button', { name: en('connections.numbers.assign') }).click();
  const dialog = page.getByRole('dialog', { name: en('connections.assign.title') });
  await dialog.getByRole('radio', { name: /Accueil boutique/ }).check();
  await forceResponse(request, { route: '/bots/demo-3/number', method: 'PUT', ...HOLDER_CHANGED, times: 1 });
  await dialog.getByRole('button', { name: en('connections.assign.submit'), exact: true }).click();
  await expectEnglishRefusal(page, dialog.getByRole('alert'), 'assign.holder_changed', HOLDER_CHANGED.message);
});

// garde D-2 de la tâche 16, audit R-15
test(`ligne 23, vérifier maintenant : un compte retiré est refusé avec le texte de la clé, « retiré de WABAGENT »`, async ({ page, request }) => {
  await openOrganisation(page, 'connexions');
  // Texte du moteur d'avant la tâche 16b, qui diverge de la clé : l'écran qui lirait le texte du moteur dirait « déconnecté ».
  await forceResponse(request, { route: '/whatsapp-accounts/1/verify', method: 'POST', status: 409, message: 'Ce compte WhatsApp est déconnecté : raccordez un nouveau compte.', reason: 'whatsapp_account.disconnected', times: 1 });
  await accountMenu(page).click();
  await page.getByRole('menuitem', { name: fr('connections.menu.verify') }).click();
  const dialog = page.getByRole('dialog', { name: fr('connections.verify.title') });
  await expect(dialog.getByRole('alert')).toHaveText(fr('errors.reasons.whatsapp_account.disconnected'));
  await expect(page.getByText(/déconnecté/)).toHaveCount(0);
});

// garde D-2 de la tâche 16, audit R-15
test('anglais, whatsapp_account.disconnected : vérifier un compte retiré refuse en anglais, jamais le texte du moteur', async ({ page, request }) => {
  await openEnglish(page, 'connexions');
  // texte réel du moteur (whatsapp-account-service.ts), au vocabulaire « retiré de WABAGENT »
  const engineFrench = 'Ce compte WhatsApp a été retiré de WABAGENT : raccordez un nouveau compte.';
  await forceResponse(request, { route: '/whatsapp-accounts/1/verify', method: 'POST', status: 409, message: engineFrench, reason: 'whatsapp_account.disconnected', times: 1 });
  await page.getByRole('button', { name: `${en('actions.manage')} (${ACCOUNT})` }).click();
  await page.getByRole('menuitem', { name: en('connections.menu.verify') }).click();
  const dialog = page.getByRole('dialog', { name: en('connections.verify.title') });
  await expect(dialog.getByRole('alert')).toHaveText(en('errors.reasons.whatsapp_account.disconnected'));
  await expect(page.getByText(engineFrench)).toHaveCount(0);
});

// garde D-1 de la tâche 16, audit R-14 : la panne en anglais a le texte contextuel anglais et « Reference: »
test('anglais, renommer un compte : panne 500 avec texte contextuel anglais et référence', async ({ page, request }) => {
  await openEnglish(page, 'connexions');
  await page.getByRole('button', { name: `${en('actions.manage')} (${ACCOUNT})` }).click();
  await page.getByRole('menuitem', { name: en('connections.menu.rename') }).click();
  const dialog = page.getByRole('dialog', { name: en('connections.rename.title') });
  await dialog.getByLabel(en('connections.rename.label')).fill('Boutique Nord');
  await forceResponse(request, { route: '/whatsapp-accounts/1', method: 'PATCH', status: 500, requestId: 'req-cnx-rename-en', times: 1 });
  await dialog.getByRole('button', { name: en('connections.rename.save') }).click();
  const alert = dialog.getByRole('alert').filter({ hasText: reference('req-cnx-rename-en', 'en') });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(en('connections.dialogs.failed'));
  await expect(page.getByText('Erreur interne.')).toHaveCount(0);
});
