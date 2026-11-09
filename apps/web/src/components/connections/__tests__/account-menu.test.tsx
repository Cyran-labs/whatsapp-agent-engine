import { screen, waitFor, within } from '@testing-library/react';
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
  expect(await within(dialog).findByText("Jeton d'accès valide")).toBeInTheDocument();
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
  stubFetch(() => engineError(409, 'CONFLICT', 'Ce compte WhatsApp est déconnecté : raccordez un nouveau compte.'));
  const { onChanged } = renderMenu();
  await choose('Vérifier maintenant');
  expect(await screen.findByRole('alert')).toHaveTextContent('Ce compte WhatsApp est déconnecté : raccordez un nouveau compte.');
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

test('Rafraîchir les numéros : un refus autre que 422 (409) ne relit pas la page', async () => {
  stubFetch(() => engineError(409, 'CONFLICT', 'Ce compte WhatsApp est déconnecté : raccordez un nouveau compte.'));
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
  stubFetch(() => engineError(409, 'CONFLICT', "Désactivez d'abord les agents IA qui utilisent ce compte :", [{ path: 'bots.conseil', message: 'Conseil Marais' }], 'whatsapp_account.in_use'));
  const { onChanged, onRemoved } = renderMenu();
  await choose('Retirer de WABAGENT');
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Retirer le compte' }));
  expect(await screen.findByRole('alert')).toHaveTextContent("Désactivez d'abord les agents IA qui utilisent ce compte :");
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
