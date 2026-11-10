import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { AccountMenu } from '../account-menu';
import { accountView } from './fixtures';
import { engineError, json, renderIntl, stubFetch, type Call } from './helpers';

beforeEach(() => {
  vi.restoreAllMocks();
});

const account = accountView({ id: 5, name: 'Boutique principale' });

function renderMenu(over = account) {
  const onChanged = vi.fn();
  const onRemoved = vi.fn();
  renderIntl(<AccountMenu account={over} onChanged={onChanged} onRemoved={onRemoved} />);
  return { onChanged, onRemoved };
}

async function openMenu() {
  await userEvent.click(screen.getByRole('button', { name: 'Gérer (Boutique principale)' }));
  return screen.getByRole('menu');
}

async function choose(name: string) {
  await openMenu();
  await userEvent.click(screen.getByRole('menuitem', { name }));
}

const inventory = { added: 0, removed: 0, refused: 0, skipped_sandbox: 0, skipped_invalid: 0 };

test('le menu propose les cinq actions du compte', async () => {
  stubFetch(() => json({}));
  renderMenu();
  const menu = await openMenu();
  expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
    'Renommer',
    'Remplacer les identifiants',
    'Vérifier maintenant',
    'Rafraîchir les numéros',
    'Retirer de WABAGENT',
  ]);
});

// audit décisions A23 : des identifiants illisibles ne se remplacent pas ; l'entrée le dit avant toute saisie
test('compte aux identifiants illisibles (cause reconnect) : « Remplacer les identifiants » désactivé avec sa raison, sans effet', async () => {
  const calls = stubFetch(() => json({}));
  renderMenu(accountView({ id: 5, name: 'Boutique principale', state: 'error', error_reason: 'other', error_detail: 'Identifiants enregistrés illisibles', error_cause: 'reconnect' }));
  await openMenu();
  const item = screen.getByRole('menuitem', { name: 'Remplacer les identifiants' });
  expect(item).toHaveAttribute('aria-disabled', 'true');
  expect(item).toHaveAccessibleDescription('Les identifiants enregistrés ne se lisent plus : retirez ce compte de WABAGENT puis raccordez-le de nouveau.');
  await userEvent.click(item);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(calls).toEqual([]);
  // « Retirer de WABAGENT », la suite indiquée, reste possible
  expect(screen.getByRole('menuitem', { name: 'Retirer de WABAGENT' })).not.toHaveAttribute('aria-disabled');
});

// revue de la tâche 19 : « Rafraîchir les numéros » lit les identifiants enregistrés, il ne peut jamais réussir ici
test('compte aux identifiants illisibles : « Rafraîchir les numéros » désactivé avec la même raison, sans appel ; « Vérifier maintenant » reste actif', async () => {
  const calls = stubFetch(() => json({}));
  renderMenu(accountView({ id: 5, name: 'Boutique principale', state: 'error', error_reason: 'other', error_detail: 'Identifiants enregistrés illisibles', error_cause: 'reconnect' }));
  await openMenu();
  const refresh = screen.getByRole('menuitem', { name: 'Rafraîchir les numéros' });
  expect(refresh).toHaveAttribute('aria-disabled', 'true');
  expect(refresh).toHaveAccessibleDescription('Les identifiants enregistrés ne se lisent plus : retirez ce compte de WABAGENT puis raccordez-le de nouveau.');
  await userEvent.click(refresh);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(calls).toEqual([]);
  expect(screen.getByRole('menuitem', { name: 'Vérifier maintenant' })).not.toHaveAttribute('aria-disabled');
});

test('interface anglaise, cause reconnect : raison traduite', async () => {
  stubFetch(() => json({}));
  const onChanged = vi.fn();
  renderIntl(<AccountMenu account={accountView({ id: 5, name: 'Boutique principale', state: 'error', error_reason: 'other', error_detail: 'Identifiants enregistrés illisibles', error_cause: 'reconnect' })} onChanged={onChanged} onRemoved={vi.fn()} />, 'en');
  await userEvent.click(screen.getByRole('button', { name: 'Manage (Boutique principale)' }));
  expect(screen.getByRole('menuitem', { name: 'Replace credentials' })).toHaveAccessibleDescription('The saved credentials can no longer be read: remove this account from WABAGENT, then connect it again.');
});

// une autre cause d'erreur garde l'entrée active : remplacer les identifiants est justement le remède
test('compte en erreur pour des identifiants refusés (cause credentials) : « Remplacer les identifiants » reste actif', async () => {
  stubFetch(() => json({}));
  renderMenu(accountView({ id: 5, name: 'Boutique principale', state: 'error', error_reason: 'token_invalid', error_detail: 'Jeton refusé par Meta', error_cause: 'credentials' }));
  await openMenu();
  expect(screen.getByRole('menuitem', { name: 'Remplacer les identifiants' })).not.toHaveAttribute('aria-disabled');
});

test('clavier : le focus arrive sur le premier élément, flèches bas et haut, Échap ferme et rend le focus au bouton', async () => {
  stubFetch(() => json({}));
  renderMenu();
  const trigger = screen.getByRole('button', { name: 'Gérer (Boutique principale)' });
  await openMenu();
  const items = screen.getAllByRole('menuitem');
  expect(items[0]).toHaveFocus();
  expect(items.every((i) => i.hasAttribute('data-menu-nav'))).toBe(true);
  await userEvent.keyboard('{ArrowDown}');
  expect(items[1]).toHaveFocus();
  await userEvent.keyboard('{ArrowUp}{ArrowUp}');
  expect(items[4]).toHaveFocus();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

test('Vérifier maintenant : POST /verify puis les contrôles s\'affichent', async () => {
  const calls = stubFetch(() =>
    json({
      ...account,
      checks: [
        { key: 'token', status: 'ok' },
        { key: 'app_secret', status: 'pending' },
        { key: 'subscription', status: 'ok' },
      ],
      outcome: 'verified',
    }),
  );
  const { onChanged } = renderMenu();
  await choose('Vérifier maintenant');
  const dialog = await screen.findByRole('dialog', { name: 'Vérification du compte' });
  expect(await within(dialog).findByText("Jeton d'accès")).toBeInTheDocument();
  expect(within(dialog).getByText('contrôlé au premier message reçu')).toBeInTheDocument();
  expect(within(dialog).getByText('Vérification réussie.')).toBeInTheDocument();
  expect(calls).toEqual([{ url: '/api/whatsapp-accounts/5/verify', method: 'POST', body: undefined }]);
  expect(onChanged).toHaveBeenCalledTimes(1);
});

test('Vérifier maintenant : issue inconclusive du moteur, « Vérification non concluante. Réessayez. »', async () => {
  stubFetch(() =>
    json({ ...account, state: 'connected', outcome: 'inconclusive', checks: [{ key: 'token', status: 'failed', detail: 'Le fournisseur ne répond pas, réessayez.' }] }),
  );
  renderMenu();
  await choose('Vérifier maintenant');
  const dialog = await screen.findByRole('dialog', { name: 'Vérification du compte' });
  expect(await within(dialog).findByText('Vérification non concluante. Réessayez.')).toBeInTheDocument();
  expect(within(dialog).getByText('Le fournisseur ne répond pas, réessayez.')).toBeInTheDocument();
});

test('Vérifier maintenant : issue refusée (compte en erreur), jamais « non concluante »', async () => {
  stubFetch(() => json({ ...account, state: 'error', outcome: 'refused', checks: [{ key: 'token', status: 'failed', detail: 'Jeton expiré' }] }));
  renderMenu();
  await choose('Vérifier maintenant');
  const dialog = await screen.findByRole('dialog', { name: 'Vérification du compte' });
  expect(await within(dialog).findByText('Vérification refusée : le compte est passé en erreur.')).toBeInTheDocument();
  expect(within(dialog).queryByText(/non concluante/)).not.toBeInTheDocument();
});

// revue de la tâche 19 : un compte déjà en erreur avant la vérification n'y « passe » pas, il y reste
test('Vérifier maintenant sur un compte déjà en erreur, issue refusée : « le compte reste en erreur » ; connecté avant : « est passé en erreur »', async () => {
  const errored = accountView({ id: 5, name: 'Boutique principale', state: 'error', error_reason: 'token_invalid', error_detail: 'Jeton refusé par Meta', error_cause: 'credentials' });
  stubFetch(() => json({ ...errored, outcome: 'refused', checks: [{ key: 'token', status: 'failed', detail: 'Jeton refusé par Meta' }] }));
  renderMenu(errored);
  await choose('Vérifier maintenant');
  const dialog = await screen.findByRole('dialog', { name: 'Vérification du compte' });
  expect(await within(dialog).findByText('Vérification refusée : le compte reste en erreur.')).toBeInTheDocument();
  expect(within(dialog).queryByText(/est passé en erreur/)).not.toBeInTheDocument();
  cleanup();

  stubFetch(() => json({ ...account, state: 'error', outcome: 'refused', checks: [{ key: 'token', status: 'failed', detail: 'Jeton refusé par Meta' }] }));
  renderMenu();
  await choose('Vérifier maintenant');
  expect(await screen.findByText('Vérification refusée : le compte est passé en erreur.')).toBeInTheDocument();
  expect(screen.queryByText(/reste en erreur/)).not.toBeInTheDocument();
});

test('interface anglaise, Vérifier maintenant refusé : « still in error » pour un compte déjà en erreur, « now in error » sinon', async () => {
  const errored = accountView({ id: 5, name: 'Boutique principale', state: 'error', error_reason: 'token_invalid', error_detail: 'Jeton refusé par Meta', error_cause: 'credentials' });
  for (const [before, expected] of [[errored, 'Verification refused: the account is still in error.'], [account, 'Verification refused: the account is now in error.']] as const) {
    stubFetch(() => json({ ...account, state: 'error', outcome: 'refused', checks: [] }));
    renderIntl(<AccountMenu account={before} onChanged={vi.fn()} onRemoved={vi.fn()} />, 'en');
    await userEvent.click(screen.getByRole('button', { name: 'Manage (Boutique principale)' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Verify now' }));
    expect(await screen.findByText(expected)).toBeInTheDocument();
    cleanup();
  }
});

// Fournisseur OK mais app Meta non conforme : le moteur met le compte en erreur, tous les contrôles sont `ok`.
test('Vérifier maintenant : issue refusée avec tous les contrôles réussis, le titre suit l\'issue et non les contrôles', async () => {
  stubFetch(() =>
    json({ ...account, state: 'error', outcome: 'refused', checks: [{ key: 'token', status: 'ok' }, { key: 'app', status: 'ok' }] }),
  );
  renderMenu();
  await choose('Vérifier maintenant');
  const dialog = await screen.findByRole('dialog', { name: 'Vérification du compte' });
  expect(await within(dialog).findByText('Vérification refusée : le compte est passé en erreur.')).toBeInTheDocument();
  expect(within(dialog).queryByText('Vérification réussie.')).not.toBeInTheDocument();
});

test('Vérifier maintenant : issue inconclusive sans aucun contrôle en échec, toujours « non concluante »', async () => {
  stubFetch(() => json({ ...account, state: 'connected', outcome: 'inconclusive', checks: [{ key: 'token', status: 'ok' }] }));
  renderMenu();
  await choose('Vérifier maintenant');
  expect(await screen.findByText('Vérification non concluante. Réessayez.')).toBeInTheDocument();
});

test('Vérifier maintenant : refus du moteur affiché tel quel', async () => {
  stubFetch(() => engineError(409, 'CONFLICT', 'Ce compte WhatsApp a été retiré de WABAGENT : raccordez un nouveau compte.'));
  const { onChanged } = renderMenu();
  await choose('Vérifier maintenant');
  expect(await screen.findByRole('alert')).toHaveTextContent('Ce compte WhatsApp a été retiré de WABAGENT : raccordez un nouveau compte.');
  expect(onChanged).not.toHaveBeenCalled();
});

test('Rafraîchir les numéros : « 1 numéro ajouté, 0 retiré »', async () => {
  const calls = stubFetch(() => json({ ...account, inventory: { ...inventory, added: 1 } }));
  const { onChanged } = renderMenu();
  await choose('Rafraîchir les numéros');
  expect(await screen.findByText('1 numéro ajouté, 0 retiré')).toBeInTheDocument();
  expect(screen.queryByText(/refusé/)).not.toBeInTheDocument();
  expect(calls).toEqual([{ url: '/api/whatsapp-accounts/5/refresh-numbers', method: 'POST', body: undefined }]);
  expect(onChanged).toHaveBeenCalledTimes(1);
});

test('Rafraîchir les numéros : les numéros refusés sont comptés, sans autre détail', async () => {
  stubFetch(() => json({ ...account, inventory: { ...inventory, added: 2, removed: 1, refused: 1 } }));
  renderMenu();
  await choose('Rafraîchir les numéros');
  expect(await screen.findByText('2 numéros ajoutés, 1 retiré')).toBeInTheDocument();
  expect(screen.getByText('1 numéro refusé')).toBeInTheDocument();
});

test('Rafraîchir les numéros : le message du moteur s\'affiche en cas de refus (422) et la page est relue (compte possiblement en erreur)', async () => {
  stubFetch(() => engineError(422, 'WA_VALIDATION_FAILED', "Le fournisseur n'a renvoyé aucun numéro : rien n'a été retiré.", [{ path: 'numbers', message: "Le fournisseur n'a renvoyé aucun numéro : rien n'a été retiré." }]));
  const { onChanged } = renderMenu();
  await choose('Rafraîchir les numéros');
  expect(await screen.findByRole('alert')).toHaveTextContent("Le fournisseur n'a renvoyé aucun numéro");
  expect(onChanged).toHaveBeenCalledTimes(1);
});

// audit décisions B7 : la fenêtre dit la cause connue, et « Réessayez » seulement pour une panne passagère du fournisseur
const listingRefusal = (reason: string, message: string) =>
  engineError(422, 'WA_VALIDATION_FAILED', message, [{ path: 'numbers', message }], reason);

test('Rafraîchir les numéros, jeton refusé (Meta) : « Jeton refusé par Meta : remplacez les identifiants du compte. » avec l\'action, jamais « Réessayez »', async () => {
  const calls = stubFetch(() => listingRefusal('whatsapp_account.listing_token_invalid', 'Jeton refusé par Meta'));
  const { onChanged } = renderMenu();
  await choose('Rafraîchir les numéros');
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Jeton refusé par Meta : remplacez les identifiants du compte.');
  expect(alert).not.toHaveTextContent(/Réessayez/);
  expect(onChanged).toHaveBeenCalledTimes(1);
  // l'action ouvre la fenêtre de remplacement des identifiants du même compte
  await userEvent.click(within(alert).getByRole('button', { name: 'Remplacer les identifiants' }));
  expect(screen.getByRole('dialog', { name: /identifiants/ })).toBeInTheDocument();
  expect(screen.queryByText('Rafraîchissement des numéros')).not.toBeInTheDocument();
  expect(calls).toHaveLength(1);
});

test('Rafraîchir les numéros, jeton refusé (CM.com) : le fournisseur nommé est CM.com', async () => {
  stubFetch(() => listingRefusal('whatsapp_account.listing_token_invalid', 'Jeton CM.com refusé'));
  renderMenu(accountView({ id: 5, name: 'Boutique principale', mode: 'cm_com', waba_id: null }));
  await choose('Rafraîchir les numéros');
  expect(await screen.findByRole('alert')).toHaveTextContent('Jeton refusé par CM.com : remplacez les identifiants du compte.');
});

test('Rafraîchir les numéros, panne passagère : « Réessayez » ; autre cause : renvoi vers « Vérifier maintenant », sans « Réessayez »', async () => {
  stubFetch(() => listingRefusal('whatsapp_account.listing_unavailable', 'Meta injoignable'));
  renderMenu();
  await choose('Rafraîchir les numéros');
  expect(await screen.findByRole('alert')).toHaveTextContent('Le fournisseur ne répond pas pour le moment. Réessayez dans quelques minutes.');
  expect(within(screen.getByRole('alert')).queryByRole('button')).not.toBeInTheDocument();
  cleanup();

  stubFetch(() => listingRefusal('whatsapp_account.listing_failed', 'Liste de numéros illisible'));
  renderMenu();
  await choose('Rafraîchir les numéros');
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Lecture des numéros auprès du fournisseur impossible : lancez « Vérifier maintenant » pour en connaître la cause.');
  expect(alert).not.toHaveTextContent(/Réessayez/);
});

test('interface anglaise : mêmes causes, textes anglais, aucun texte français du moteur', async () => {
  const cases: Array<[string, string, string]> = [
    ['whatsapp_account.listing_token_invalid', 'Jeton refusé par Meta', 'Token refused by Meta: replace the account\'s credentials.'],
    ['whatsapp_account.listing_unavailable', 'Meta injoignable', 'The provider is not responding right now. Try again in a few minutes.'],
    ['whatsapp_account.listing_failed', 'Liste de numéros illisible', 'Could not read the numbers from the provider: run "Verify now" to find the cause.'],
  ];
  for (const [reason, engine, expected] of cases) {
    stubFetch(() => listingRefusal(reason, engine));
    renderIntl(<AccountMenu account={account} onChanged={vi.fn()} onRemoved={vi.fn()} />, 'en');
    await userEvent.click(screen.getByRole('button', { name: 'Manage (Boutique principale)' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Refresh numbers' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(expected);
    expect(alert).not.toHaveTextContent(engine);
    if (reason === 'whatsapp_account.listing_token_invalid') expect(within(alert).getByRole('button', { name: 'Replace credentials' })).toBeInTheDocument();
    cleanup();
  }
});

test('Rafraîchir les numéros : un refus autre que 422 (409) ne relit pas la page', async () => {
  stubFetch(() => engineError(409, 'CONFLICT', 'Ce compte WhatsApp a été retiré de WABAGENT : raccordez un nouveau compte.'));
  const { onChanged } = renderMenu();
  await choose('Rafraîchir les numéros');
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(onChanged).not.toHaveBeenCalled();
});

test('Renommer : champ prérempli du nom, PATCH avec le nouveau nom, onChanged', async () => {
  const calls = stubFetch(() => json({ ...account, name: 'Boutique Lyon' }));
  const { onChanged } = renderMenu();
  await choose('Renommer');
  const field = screen.getByLabelText('Nom du compte');
  expect(field).toHaveValue('Boutique principale');
  await userEvent.clear(field);
  await userEvent.type(field, 'Boutique Lyon{Enter}');
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(calls).toEqual([{ url: '/api/whatsapp-accounts/5', method: 'PATCH', body: { name: 'Boutique Lyon' } }]);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('Renommer : refus du moteur affiché, la fenêtre reste ouverte', async () => {
  stubFetch(() => engineError(400, 'VALIDATION_ERROR', 'Données invalides.', [{ path: 'name', message: 'Le nom est requis.' }]));
  const { onChanged } = renderMenu();
  await choose('Renommer');
  await userEvent.clear(screen.getByLabelText('Nom du compte'));
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Le nom est requis.');
  expect(onChanged).not.toHaveBeenCalled();
});

// recette Q-5
test('Retirer de WABAGENT : confirmation, 204, fenêtre fermée et onRemoved appelé (la page relit et notifie)', async () => {
  const calls = stubFetch(() => new Response(null, { status: 204 }));
  const { onChanged, onRemoved } = renderMenu();
  await choose('Retirer de WABAGENT');
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Retirer le compte' }));
  await waitFor(() => expect(onRemoved).toHaveBeenCalledTimes(1));
  expect(onChanged).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(calls).toEqual([{ url: '/api/whatsapp-accounts/5/disconnect', method: 'POST', body: undefined } satisfies Call]);
});

test('Retirer refusé (409 whatsapp_account.in_use) : texte du moteur dans la fenêtre, onRemoved non appelé', async () => {
  stubFetch(() => engineError(409, 'CONFLICT', "Passez d'abord Offline les agents IA qui utilisent ce compte :", [{ path: 'bots.conseil', message: 'Conseil Marais' }], 'whatsapp_account.in_use'));
  const { onChanged, onRemoved } = renderMenu();
  await choose('Retirer de WABAGENT');
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Retirer le compte' }));
  expect(await screen.findByRole('alert')).toHaveTextContent("Passez d'abord Offline les agents IA qui utilisent ce compte :");
  expect(onRemoved).not.toHaveBeenCalled();
  expect(onChanged).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('Remplacer les identifiants ouvre la fenêtre de remplacement', async () => {
  stubFetch(() => json({}));
  renderMenu();
  await choose('Remplacer les identifiants');
  expect(screen.getByRole('dialog', { name: 'Remplacer les identifiants' })).toBeInTheDocument();
});

test.each([
  ['Renommer', 'Annuler'],
  ['Remplacer les identifiants', 'Annuler'],
  ['Retirer de WABAGENT', 'Annuler'],
])('« %s » : à la fermeture de la fenêtre, le focus revient au bouton « Gérer »', async (item, close) => {
  stubFetch(() => json({}));
  renderMenu();
  await choose(item);
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: close }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Gérer (Boutique principale)' })).toHaveFocus();
});

test('fenêtre fermée par Échap : le focus revient au bouton « Gérer »', async () => {
  stubFetch(() => json({ ...account, checks: [], outcome: 'verified' }));
  renderMenu();
  await choose('Vérifier maintenant');
  await screen.findByRole('dialog');
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Gérer (Boutique principale)' })).toHaveFocus();
});
