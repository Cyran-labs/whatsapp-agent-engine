import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { ReplaceCredentialsDialog } from '../replace-credentials-dialog';
import { accountView } from './fixtures';
import { engineError, json, renderIntl, stubFetch } from './helpers';

beforeEach(() => {
  vi.restoreAllMocks();
});

function renderDialog(account = accountView({ id: 3 })) {
  const onClose = vi.fn();
  const onDone = vi.fn();
  renderIntl(<ReplaceCredentialsDialog account={account} onClose={onClose} onDone={onDone} />);
  return { onClose, onDone };
}

const okChecks = [
  { key: 'token', status: 'ok' },
  { key: 'waba_access', status: 'ok' },
  { key: 'app_secret', status: 'ok' },
  { key: 'subscription', status: 'created' },
  { key: 'token_expiry', status: 'ok', detail: 'Jeton sans expiration' },
  { key: 'numbers', status: 'ok' },
];

test('Meta : trois champs vides (aucun préremplissage des secrets), secrets masqués', () => {
  stubFetch(() => json({}));
  renderDialog();
  const waba = screen.getByLabelText('WABA ID');
  const token = screen.getByLabelText("Jeton d'accès");
  const secret = screen.getByLabelText("Secret de l'app Meta");
  for (const field of [waba, token, secret]) expect(field).toHaveValue('');
  expect(token).toHaveAttribute('type', 'password');
  expect(secret).toHaveAttribute('type', 'password');
  // Un gestionnaire de mots de passe ne doit rien préremplir.
  expect(token).toHaveAttribute('autocomplete', 'new-password');
  expect(secret).toHaveAttribute('autocomplete', 'new-password');
  expect(waba).toHaveAttribute('autocomplete', 'off');
  expect(screen.queryByLabelText('Compte CM.com')).not.toBeInTheDocument();
});

test('Meta : PUT /credentials avec mode meta_manual, puis les contrôles réussis et le bilan', async () => {
  const calls = stubFetch(() =>
    json({ ...accountView({ id: 3 }), checks: okChecks, inventory: { added: 1, removed: 0, refused: 0, skipped_sandbox: 0, skipped_invalid: 0 } }),
  );
  const { onDone } = renderDialog();
  await userEvent.type(screen.getByLabelText('WABA ID'), '104829371625544');
  await userEvent.type(screen.getByLabelText("Jeton d'accès"), 'EAAG-nouveau-jeton-1234567890');
  await userEvent.type(screen.getByLabelText("Secret de l'app Meta"), 'a1b2c3d4e5f6a7b8c9d0');
  await userEvent.click(screen.getByRole('button', { name: 'Remplacer' }));
  await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  expect(calls).toEqual([
    {
      url: '/api/whatsapp-accounts/3/credentials',
      method: 'PUT',
      body: { mode: 'meta_manual', waba_id: '104829371625544', access_token: 'EAAG-nouveau-jeton-1234567890', app_secret: 'a1b2c3d4e5f6a7b8c9d0' },
    },
  ]);
  expect(await screen.findByText('abonnement créé')).toBeInTheDocument();
  expect(screen.getByText(/1 numéro ajouté, 0 retiré/)).toBeInTheDocument();
});

// Arbitrage du contrôleur : le 422 WA_VALIDATION_FAILED porte les contrôles en échec dans error.details.
test('422 : les contrôles en échec s\'affichent par VerificationChecks, la fenêtre reste ouverte', async () => {
  stubFetch(() =>
    engineError(422, 'WA_VALIDATION_FAILED', 'Meta a refusé le jeton.', [
      { path: 'token', message: 'Jeton expiré ou révoqué' },
      { path: 'app_secret', message: 'Secret incorrect' },
    ]),
  );
  const { onDone } = renderDialog();
  await userEvent.type(screen.getByLabelText('WABA ID'), '104829371625544');
  await userEvent.type(screen.getByLabelText("Jeton d'accès"), 'EAAG-nouveau-jeton-1234567890');
  await userEvent.type(screen.getByLabelText("Secret de l'app Meta"), 'a1b2c3d4e5f6a7b8c9d0');
  await userEvent.click(screen.getByRole('button', { name: 'Remplacer' }));
  const list = await screen.findByRole('list', { name: 'Contrôles de vérification' });
  expect(within(list).getByText('Jeton expiré ou révoqué')).toBeInTheDocument();
  expect(within(list).getByText('Secret incorrect')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Meta a refusé le jeton.');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(onDone).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Jeton d'accès")).toBeEnabled();
});

test('refus du moteur sans contrôle (409) : son message, rien d\'autre', async () => {
  stubFetch(() => engineError(409, 'CONFLICT', 'Pour une autre WABA ou un autre compte CM.com, raccordez un nouveau compte.'));
  renderDialog();
  await userEvent.type(screen.getByLabelText('WABA ID'), '999999');
  await userEvent.type(screen.getByLabelText("Jeton d'accès"), 'EAAG-nouveau-jeton-1234567890');
  await userEvent.type(screen.getByLabelText("Secret de l'app Meta"), 'a1b2c3d4e5f6a7b8c9d0');
  await userEvent.click(screen.getByRole('button', { name: 'Remplacer' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Pour une autre WABA ou un autre compte CM.com, raccordez un nouveau compte.');
  expect(screen.queryByRole('list', { name: 'Contrôles de vérification' })).not.toBeInTheDocument();
});

test('CM.com : deux champs vides et PUT avec mode cm_com', async () => {
  const calls = stubFetch(() => json({ ...accountView({ id: 4, mode: 'cm_com' }), checks: [{ key: 'cm_account', status: 'ok' }], inventory: { added: 0, removed: 0, refused: 0, skipped_sandbox: 0, skipped_invalid: 0 } }));
  const { onDone } = renderDialog(accountView({ id: 4, mode: 'cm_com', waba_id: null }));
  expect(screen.queryByLabelText('WABA ID')).not.toBeInTheDocument();
  const accountId = screen.getByLabelText('Identifiant du compte CM.com');
  const productToken = screen.getByLabelText('productToken CM.com');
  expect(accountId).toHaveValue('');
  expect(productToken).toHaveValue('');
  expect(productToken).toHaveAttribute('type', 'password');
  expect(productToken).toHaveAttribute('autocomplete', 'new-password');
  await userEvent.type(accountId, '0b1f2d3c-4a5b-4c6d-8e7f-9a0b1c2d3e4f');
  await userEvent.type(productToken, 'tok-cm-0123456789');
  await userEvent.click(screen.getByRole('button', { name: 'Remplacer' }));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(calls[0]).toEqual({
    url: '/api/whatsapp-accounts/4/credentials',
    method: 'PUT',
    body: { mode: 'cm_com', account_id: '0b1f2d3c-4a5b-4c6d-8e7f-9a0b1c2d3e4f', product_token: 'tok-cm-0123456789' },
  });
});

test('erreur de validation par champ (400 du BFF) : affichée sous le champ', async () => {
  stubFetch(() => engineError(400, 'VALIDATION_ERROR', 'Données invalides.', [{ path: 'waba_id', message: 'WABA ID : 5 à 25 chiffres.' }]));
  renderDialog();
  await userEvent.type(screen.getByLabelText('WABA ID'), '12');
  await userEvent.type(screen.getByLabelText("Jeton d'accès"), 'EAAG-nouveau-jeton-1234567890');
  await userEvent.type(screen.getByLabelText("Secret de l'app Meta"), 'a1b2c3d4e5f6a7b8c9d0');
  await userEvent.click(screen.getByRole('button', { name: 'Remplacer' }));
  expect(await screen.findByText('WABA ID : 5 à 25 chiffres.')).toBeInTheDocument();
  expect(screen.getByLabelText('WABA ID')).toHaveAccessibleDescription(/5 à 25 chiffres/);
});

test('409 ORG_CHANGED : aucun message d\'erreur, rien de plus', async () => {
  stubFetch(() => engineError(409, 'ORG_CHANGED', "L'organisation a changé."));
  const { onDone } = renderDialog();
  await userEvent.type(screen.getByLabelText('WABA ID'), '104829371625544');
  await userEvent.type(screen.getByLabelText("Jeton d'accès"), 'EAAG-nouveau-jeton-1234567890');
  await userEvent.type(screen.getByLabelText("Secret de l'app Meta"), 'a1b2c3d4e5f6a7b8c9d0');
  await userEvent.click(screen.getByRole('button', { name: 'Remplacer' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Remplacer' })).toBeEnabled());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(onDone).not.toHaveBeenCalled();
});

// contre-audit D-3
test('contre-audit D-3 : refus du moteur sur un champ : le focus va au premier champ en erreur, aria-invalid posé', async () => {
  stubFetch(() => engineError(400, 'VALIDATION_ERROR', 'Données invalides.', [
    { path: 'app_secret', message: 'Saisissez la valeur complète : une valeur masquée n\'est pas acceptée.' },
    { path: 'access_token', message: 'Le jeton d\'accès semble incomplet : collez-le en entier.' },
  ]));
  renderDialog();
  await userEvent.type(screen.getByLabelText('WABA ID'), '104829371625544');
  await userEvent.type(screen.getByLabelText("Jeton d'accès"), 'EAAG-nouveau-jeton-1234567890');
  await userEvent.type(screen.getByLabelText("Secret de l'app Meta"), 'a1b2c3d4e5f6a7b8c9d0');
  await userEvent.click(screen.getByRole('button', { name: 'Remplacer' }));
  await screen.findByText(/semble incomplet/);
  await waitFor(() => expect(screen.getByLabelText("Jeton d'accès")).toHaveFocus());
  expect(screen.getByLabelText("Jeton d'accès")).toHaveAttribute('aria-invalid', 'true');
});
