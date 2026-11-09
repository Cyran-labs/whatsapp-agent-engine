import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { DisconnectDialog } from '../disconnect-dialog';
import { accountView } from './fixtures';
import { engineError, renderIntl, stubFetch } from './helpers';

beforeEach(() => {
  vi.restoreAllMocks();
});

function renderDialog() {
  const onClose = vi.fn();
  const onDone = vi.fn();
  renderIntl(<DisconnectDialog account={accountView({ id: 7, name: 'Boutique principale' })} onClose={onClose} onDone={onDone} />);
  return { onClose, onDone };
}

test('la fenêtre nomme le compte et explique ce que la déconnexion change', () => {
  stubFetch(() => new Response(null, { status: 204 }));
  renderDialog();
  expect(screen.getByRole('dialog', { name: 'Déconnecter Boutique principale ?' })).toBeInTheDocument();
  // Texte fidèle au moteur (disconnectWhatsAppAccount) : numéros retirés, agents IA en brouillon ou en pause, identifiants effacés, webhook invalidé.
  const text = screen.getByRole('dialog').textContent ?? '';
  expect(text).toContain('numéros du compte sont retirés de la liste');
  expect(text).toContain('agents IA en brouillon ou en pause qui les tenaient perdent leur numéro');
  expect(text).toContain('identifiants enregistrés sont effacés');
  expect(text).toContain("adresse de webhook du compte cesse de fonctionner");
  expect(text).toContain('il faudra le raccorder de nouveau');
});

// Point d'attention 3 de la revue : refus du moteur affiché tel quel, rien ne change à l'écran.
test('409 du moteur : son message et les agents IA nommés s\'affichent, onDone n\'est pas appelé', async () => {
  const calls = stubFetch(() =>
    engineError(409, 'CONFLICT', "Mettez d'abord en pause ou en brouillon les agents IA qui utilisent ce compte.", [
      { path: 'bots.conseil', message: 'Conseil Marais' },
      { path: 'bots.sav', message: 'SAV commandes' },
    ]),
  );
  const { onDone, onClose } = renderDialog();
  await userEvent.click(screen.getByRole('button', { name: 'Déconnecter le compte' }));
  expect(await screen.findByRole('alert')).toHaveTextContent("Mettez d'abord en pause ou en brouillon les agents IA qui utilisent ce compte.");
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
  await userEvent.click(screen.getByRole('button', { name: 'Déconnecter le compte' }));
  await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('409 ORG_CHANGED : aucun message d\'erreur, onDone n\'est pas appelé', async () => {
  stubFetch(() => engineError(409, 'ORG_CHANGED', "L'organisation a changé."));
  const { onDone } = renderDialog();
  await userEvent.click(screen.getByRole('button', { name: 'Déconnecter le compte' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Déconnecter le compte' })).toBeEnabled());
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
