import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { DisconnectDialog } from '../disconnect-dialog';
import { accountView } from './fixtures';
import { engineError, json, renderIntl, stubFetch } from './helpers';

beforeEach(() => {
  vi.restoreAllMocks();
});

function renderDialog() {
  const onClose = vi.fn();
  const onDone = vi.fn();
  renderIntl(<DisconnectDialog account={accountView({ id: 7, name: 'Boutique principale' })} onClose={onClose} onDone={onDone} />);
  return { onClose, onDone };
}

test('la fenêtre nomme le compte et explique ce que le retrait change', () => {
  stubFetch(() => new Response(null, { status: 204 }));
  renderDialog();
  expect(screen.getByRole('dialog', { name: 'Retirer Boutique principale de WABAGENT ?' })).toBeInTheDocument();
  // Texte fidèle au moteur (disconnectWhatsAppAccount) : numéros retirés, agents IA désactivés ou en brouillon, identifiants effacés, webhook invalidé.
  const text = screen.getByRole('dialog').textContent ?? '';
  expect(text).toContain('numéros du compte sont retirés de la liste');
  expect(text).toContain('agents IA Offline ou en Draft qui les tenaient perdent leur numéro');
  expect(text).toContain('identifiants enregistrés sont effacés');
  expect(text).toContain("adresse de webhook du compte cesse de fonctionner");
  expect(text).toContain('il faudra le raccorder de nouveau');
});

// Point d'attention 3 de la revue : refus du moteur affiché tel quel, rien ne change à l'écran.
test('409 du moteur : son message et les agents IA nommés s\'affichent, onDone n\'est pas appelé', async () => {
  const calls = stubFetch(() =>
    engineError(409, 'CONFLICT', "Mettez d'abord Offline les agents IA qui utilisent ce compte :", [
      { path: 'bots.conseil', message: 'Conseil Marais' },
      { path: 'bots.sav', message: 'SAV commandes' },
    ], 'whatsapp_account.in_use'),
  );
  const { onDone, onClose } = renderDialog();
  await userEvent.click(screen.getByRole('button', { name: 'Retirer le compte' }));
  expect(await screen.findByRole('alert')).toHaveTextContent("Mettez d'abord Offline les agents IA qui utilisent ce compte :");
  expect(screen.getByText('Conseil Marais')).toBeInTheDocument();
  expect(screen.getByText('SAV commandes')).toBeInTheDocument();
  expect(calls).toEqual([{ url: '/api/whatsapp-accounts/7/disconnect', method: 'POST', body: undefined }]);
  expect(onDone).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('204 : onDone est appelé', async () => {
  stubFetch(() => new Response(null, { status: 204 }));
  const { onDone } = renderDialog();
  await userEvent.click(screen.getByRole('button', { name: 'Retirer le compte' }));
  await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('409 ORG_CHANGED : aucun message d\'erreur, onDone n\'est pas appelé', async () => {
  stubFetch(() => engineError(409, 'ORG_CHANGED', "L'organisation a changé."));
  const { onDone } = renderDialog();
  await userEvent.click(screen.getByRole('button', { name: 'Retirer le compte' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retirer le compte' })).toBeEnabled());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(onDone).not.toHaveBeenCalled();
});

test('Annuler ferme sans rien envoyer', async () => {
  const calls = stubFetch(() => new Response(null, { status: 204 }));
  const { onClose } = renderDialog();
  await userEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(onClose).toHaveBeenCalled();
  expect(calls).toHaveLength(0);
});

// audit R-22
test('audit R-22 : Échap pendant l\'envoi ne ferme pas la fenêtre, Annuler est désactivé avec sa raison, le refus reste visible', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  stubFetch(async () => {
    await gate;
    return engineError(409, 'CONFLICT', "Mettez d'abord Offline les agents IA qui utilisent ce compte :", undefined, 'whatsapp_account.in_use');
  });
  const { onClose } = renderDialog();
  await userEvent.click(screen.getByRole('button', { name: 'Retirer le compte' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(onClose).not.toHaveBeenCalled();
  const cancel = within(dialog).getByRole('button', { name: 'Annuler' });
  expect(cancel).toBeDisabled();
  expect(cancel).toHaveAccessibleDescription('Envoi en cours');
  release();
  expect(await within(dialog).findByRole('alert')).toHaveTextContent("Mettez d'abord Offline");
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Annuler' })).toBeEnabled();
});

// Task 6 : la clé du refus a une traduction, c'est elle qui s'affiche ; en anglais jamais le français du moteur
test('409 whatsapp_account.in_use, interface anglaise : texte traduit, jamais le français du moteur, agents IA nommés', async () => {
  stubFetch(() =>
    engineError(409, 'CONFLICT', "Mettez d'abord Offline les agents IA qui utilisent ce compte :", [{ path: 'bots.sav', message: 'SAV commandes' }], 'whatsapp_account.in_use'),
  );
  renderIntl(<DisconnectDialog account={accountView({ id: 7, name: 'Main shop' })} onClose={vi.fn()} onDone={vi.fn()} />, 'en');
  await userEvent.click(screen.getByRole('button', { name: 'Remove account' }));
  expect(await screen.findByRole('alert')).not.toHaveTextContent('Désactivez');
  expect(screen.getByText('SAV commandes')).toBeInTheDocument();
});

test('panne du moteur (500) : texte contextuel et référence, onDone non appelé', async () => {
  stubFetch(() => json({ error: { code: 'INTERNAL', message: 'boom', request_id: 'req-42' } }, 500));
  const { onDone } = renderDialog();
  await userEvent.click(screen.getByRole('button', { name: 'Retirer le compte' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Action impossible pour le moment. Réessayez.');
  expect(alert).toHaveTextContent('req-42');
  expect(onDone).not.toHaveBeenCalled();
});

// revue Minor 7 : un refus métier sans clé connue garde un texte d'action, pas celui d'une panne serveur
test('409 sans clé connue, interface anglaise : « Action failed. Please try again. », jamais le français ni le texte de panne', async () => {
  stubFetch(() => engineError(409, 'CONFLICT', 'Un refus que le web ne connaît pas.'));
  renderIntl(<DisconnectDialog account={accountView({ id: 7, name: 'Main shop' })} onClose={vi.fn()} onDone={vi.fn()} />, 'en');
  await userEvent.click(screen.getByRole('button', { name: 'Remove account' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Action failed. Please try again.');
  expect(alert).not.toHaveTextContent('refus');
});
