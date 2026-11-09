import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import en from '../../../../messages/en.json';
import type { WhatsAppAccountCreated } from '@wabagent/contracts';
import { ConnectForm } from '../connect-form';
import { accountView, webhookView } from './fixtures';
import { engineError, json, renderIntl, stubFetch } from './helpers';

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

const created: WhatsAppAccountCreated = {
  ...accountView({ id: 7, name: 'Boutique principale' }),
  webhook: webhookView(),
  checks: [{ key: 'token', status: 'ok' }],
  inventory: { added: 1, removed: 0, refused: 0, skipped_sandbox: 0, skipped_invalid: 0 },
};

const META_TOKEN = 'EAAG-jeton-long-1234567890';
const META_SECRET = 'a1b2c3d4e5f6a7b8c9d0';
const CM_ACCOUNT = '0b1f2d3c-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

function renderForm() {
  const onCreated = vi.fn();
  renderIntl(<ConnectForm onCreated={onCreated} />);
  return { onCreated };
}

async function fillMeta(waba = '104829371625544') {
  await userEvent.type(screen.getByLabelText('Nom du compte dans WABAGENT'), 'Boutique principale');
  await userEvent.type(screen.getByLabelText('ID du compte WhatsApp Business (WABA)'), waba);
  await userEvent.type(screen.getByLabelText("Jeton d'accès"), META_TOKEN);
  await userEvent.type(screen.getByLabelText("Secret de l'app"), META_SECRET);
}

const submit = () => userEvent.click(screen.getByRole('button', { name: 'Vérifier et raccorder' }));

test('trois modes : « Connexion Meta » grisé, non cliquable, avec « Bientôt » et son explication', async () => {
  renderForm();
  const group = screen.getByRole('radiogroup', { name: 'Mode de raccordement' });
  const meta = within(group).getByRole('radio', { name: /API Meta directe/ });
  const embedded = within(group).getByRole('radio', { name: /Connexion Meta/ });
  const cm = within(group).getByRole('radio', { name: /CM\.com/ });
  expect(meta).toBeChecked();
  expect(embedded).toBeDisabled();
  expect(within(group).getByText('Bientôt')).toBeInTheDocument();
  expect(within(group).getByText(/En un clic avec Facebook/)).toBeInTheDocument();
  await userEvent.click(embedded);
  expect(meta).toBeChecked();
  expect(cm).toBeEnabled();
});

test('prérequis, guide Meta et encart du numéro dédié', () => {
  renderForm();
  expect(screen.getByText(/portefeuille Meta Business avec l'entreprise vérifiée/)).toBeInTheDocument();
  expect(screen.getByText('Créer une app Meta et y ajouter WhatsApp')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Ouvrir le guide pas à pas/ })).toHaveAttribute('target', '_blank');
  expect(screen.getByText(/Facultatif pour démarrer sur le numéro de test/)).toBeInTheDocument();
  const note = screen.getByRole('note');
  expect(note).toHaveTextContent('numéro dédié');
  expect(note).toHaveTextContent('historique');
  expect(note).toHaveTextContent('Connexion Meta');
  expect(screen.getByText("Rien n'est enregistré tant que la vérification échoue.")).toBeInTheDocument();
});

test('champs secrets masqués, sans préremplissage par le navigateur', () => {
  renderForm();
  for (const label of ["Jeton d'accès", "Secret de l'app"]) {
    const field = screen.getByLabelText(label);
    expect(field).toHaveAttribute('type', 'password');
    expect(field).toHaveAttribute('autocomplete', 'new-password');
  }
  expect(screen.getByLabelText('ID du compte WhatsApp Business (WABA)')).toHaveAttribute('autocomplete', 'off');
});

test('Meta : un WABA non numérique bloque l\'envoi avec le message du contrat, sans appel', async () => {
  const calls = stubFetch(() => json({}));
  const { onCreated } = renderForm();
  await fillMeta('abc');
  await submit();
  const field = screen.getByLabelText('ID du compte WhatsApp Business (WABA)');
  expect(field).toHaveAccessibleDescription(/WABA ID : 5 à 25 chiffres\./);
  expect(field).toBeInvalid();
  expect(field).toHaveFocus();
  expect(calls).toEqual([]);
  expect(onCreated).not.toHaveBeenCalled();
});

test('Meta : champs vides bloqués, un message par champ', async () => {
  const calls = stubFetch(() => json({}));
  renderForm();
  await submit();
  expect(screen.getByLabelText('Nom du compte dans WABAGENT')).toBeInvalid();
  expect(screen.getByLabelText("Jeton d'accès")).toBeInvalid();
  expect(screen.getByLabelText("Secret de l'app")).toBeInvalid();
  expect(calls).toEqual([]);
});

test('Meta : envoi valide, POST /api/whatsapp-accounts avec mode meta_manual et le nom, puis secrets vidés', async () => {
  const calls = stubFetch(() => json(created, 201));
  const { onCreated } = renderForm();
  await fillMeta();
  await submit();
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
  expect(calls).toEqual([
    {
      url: '/api/whatsapp-accounts',
      method: 'POST',
      body: { mode: 'meta_manual', name: 'Boutique principale', waba_id: '104829371625544', access_token: META_TOKEN, app_secret: META_SECRET },
    },
  ]);
  expect(screen.getByLabelText("Jeton d'accès")).toHaveValue('');
  expect(screen.getByLabelText("Secret de l'app")).toHaveValue('');
});

test('422 : contrôles en échec affichés, champs conservés, aucun résultat', async () => {
  stubFetch(() =>
    engineError(422, 'WA_VALIDATION_FAILED', 'Meta a refusé le jeton.', [
      { path: 'token', message: 'Jeton expiré ou révoqué' },
      { path: 'app_secret', message: 'Secret incorrect' },
    ]),
  );
  const { onCreated } = renderForm();
  await fillMeta();
  await submit();
  const list = await screen.findByRole('list', { name: 'Contrôles de vérification' });
  expect(within(list).getByText('Jeton expiré ou révoqué')).toBeInTheDocument();
  expect(within(list).getByText('Secret incorrect')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Meta a refusé le jeton.');
  expect(onCreated).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Nom du compte dans WABAGENT')).toHaveValue('Boutique principale');
  expect(screen.getByLabelText("Jeton d'accès")).toHaveValue(META_TOKEN);
  expect(screen.getByLabelText("Secret de l'app")).toHaveValue(META_SECRET);
  expect(screen.getByRole('button', { name: 'Vérifier et raccorder' })).toBeEnabled();
});

test('409 (compte déjà raccordé) : message neutre du moteur, rien d\'autre', async () => {
  stubFetch(() => engineError(409, 'CONFLICT', 'Ce compte WhatsApp ne peut pas être raccordé.'));
  const { onCreated } = renderForm();
  await fillMeta();
  await submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('Ce compte WhatsApp ne peut pas être raccordé.');
  expect(screen.queryByRole('list', { name: 'Contrôles de vérification' })).not.toBeInTheDocument();
  expect(onCreated).not.toHaveBeenCalled();
});

test('erreur par champ renvoyée par le BFF (400) : affichée sous le champ', async () => {
  stubFetch(() => engineError(400, 'VALIDATION_ERROR', 'Données invalides.', [{ path: 'name', message: 'Nom déjà utilisé.' }]));
  renderForm();
  await fillMeta();
  await submit();
  expect(await screen.findByText('Nom déjà utilisé.')).toBeInTheDocument();
  expect(screen.getByLabelText('Nom du compte dans WABAGENT')).toHaveAccessibleDescription(/Nom déjà utilisé/);
});

// Point d'attention 2 : organisation changée dans un autre onglet.
test('409 ORG_CHANGED : rien n\'est affiché, aucun résultat', async () => {
  stubFetch(() => engineError(409, 'ORG_CHANGED', "L'organisation a changé."));
  const { onCreated } = renderForm();
  await fillMeta();
  await submit();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Vérifier et raccorder' })).toBeEnabled());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Contrôles de vérification' })).not.toBeInTheDocument();
  expect(onCreated).not.toHaveBeenCalled();
});

test('CM.com : guide propre au mode, deux champs, secret masqué', async () => {
  renderForm();
  await userEvent.click(screen.getByRole('radio', { name: /CM\.com/ }));
  expect(screen.queryByLabelText('ID du compte WhatsApp Business (WABA)')).not.toBeInTheDocument();
  expect(screen.queryByText('Créer une app Meta et y ajouter WhatsApp')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Identifiant du compte CM.com (accountId)')).toHaveAttribute('autocomplete', 'off');
  const token = screen.getByLabelText('productToken');
  expect(token).toHaveAttribute('type', 'password');
  expect(token).toHaveAttribute('autocomplete', 'new-password');
});

test('CM.com : un account_id qui n\'est pas un UUID bloque l\'envoi', async () => {
  const calls = stubFetch(() => json({}));
  renderForm();
  await userEvent.click(screen.getByRole('radio', { name: /CM\.com/ }));
  await userEvent.type(screen.getByLabelText('Nom du compte dans WABAGENT'), 'Compte CM');
  await userEvent.type(screen.getByLabelText('Identifiant du compte CM.com (accountId)'), '12345');
  await userEvent.type(screen.getByLabelText('productToken'), 'tok-cm-0123456789');
  await submit();
  expect(screen.getByLabelText('Identifiant du compte CM.com (accountId)')).toBeInvalid();
  expect(calls).toEqual([]);
});

test('CM.com : envoi valide avec mode cm_com, sans champ Meta', async () => {
  const calls = stubFetch(() => json({ ...created, mode: 'cm_com' }, 201));
  const { onCreated } = renderForm();
  await userEvent.click(screen.getByRole('radio', { name: /CM\.com/ }));
  await userEvent.type(screen.getByLabelText('Nom du compte dans WABAGENT'), 'Compte CM');
  await userEvent.type(screen.getByLabelText('Identifiant du compte CM.com (accountId)'), CM_ACCOUNT);
  await userEvent.type(screen.getByLabelText('productToken'), 'tok-cm-0123456789');
  await submit();
  await waitFor(() => expect(onCreated).toHaveBeenCalled());
  expect(calls).toEqual([
    { url: '/api/whatsapp-accounts', method: 'POST', body: { mode: 'cm_com', name: 'Compte CM', account_id: CM_ACCOUNT, product_token: 'tok-cm-0123456789' } },
  ]);
  expect(screen.getByLabelText('productToken')).toHaveValue('');
});

test('envoi unique : le bouton est désactivé pendant la vérification', async () => {
  let release: (res: Response) => void = () => undefined;
  const calls = stubFetch(() => new Promise<Response>((resolve) => { release = resolve; }));
  renderForm();
  await fillMeta();
  await submit();
  const button = await screen.findByRole('button', { name: 'Vérification en cours…' });
  expect(button).toBeDisabled();
  await userEvent.click(button);
  expect(calls).toHaveLength(1);
  release(json(created, 201));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Vérifier et raccorder' })).toBeEnabled());
});

test('« Annuler » mène à Connexions', () => {
  renderForm();
  expect(screen.getByRole('link', { name: 'Annuler' })).toHaveAttribute('href', '/organisation/connexions');
});

// Correction de revue : un secret trop long n'est pas « incomplet ».
test('valeur au-delà du maximum du contrat : message « trop long », pas « incomplet »', async () => {
  const calls = stubFetch(() => json({}));
  renderForm();
  await fillMeta();
  fireEvent.change(screen.getByLabelText("Jeton d'accès"), { target: { value: 'x'.repeat(1001) } });
  fireEvent.change(screen.getByLabelText("Secret de l'app"), { target: { value: 'a1b2' } });
  await submit();
  expect(screen.getByLabelText("Jeton d'accès")).toHaveAccessibleDescription('Valeur trop longue : vérifiez que vous avez collé seulement la valeur.');
  expect(screen.getByLabelText("Secret de l'app")).toHaveAccessibleDescription("Secret de l'app incomplet : collez-le en entier.");
  expect(calls).toEqual([]);
});

// Correction de revue : le message du WABA ID suit la langue de l'interface.
test('interface en anglais : le message du WABA ID est en anglais', async () => {
  stubFetch(() => json({}));
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ConnectForm onCreated={vi.fn()} />
    </NextIntlClientProvider>,
  );
  await userEvent.type(screen.getByLabelText('WhatsApp Business account ID (WABA)'), 'abc');
  await userEvent.click(screen.getByRole('button', { name: 'Verify and connect' }));
  expect(screen.getByLabelText('WhatsApp Business account ID (WABA)')).toHaveAccessibleDescription(/WABA ID: 5 to 25 digits\./);
});

// Correction de revue : changer de mode ne laisse aucun secret de l'autre mode.
test('changer de mode vide les secrets saisis ; le POST ne porte que les champs du mode choisi', async () => {
  const calls = stubFetch(() => json({ ...created, mode: 'cm_com' }, 201));
  const { onCreated } = renderForm();
  await fillMeta();
  await userEvent.click(screen.getByRole('radio', { name: /CM\.com/ }));
  await userEvent.click(screen.getByRole('radio', { name: /API Meta directe/ }));
  expect(screen.getByLabelText("Jeton d'accès")).toHaveValue('');
  expect(screen.getByLabelText("Secret de l'app")).toHaveValue('');
  await userEvent.type(screen.getByLabelText("Jeton d'accès"), META_TOKEN);
  await userEvent.click(screen.getByRole('radio', { name: /CM\.com/ }));
  await userEvent.type(screen.getByLabelText('Identifiant du compte CM.com (accountId)'), CM_ACCOUNT);
  await userEvent.type(screen.getByLabelText('productToken'), 'tok-cm-0123456789');
  await submit();
  await waitFor(() => expect(onCreated).toHaveBeenCalled());
  expect(calls).toEqual([
    { url: '/api/whatsapp-accounts', method: 'POST', body: { mode: 'cm_com', name: 'Boutique principale', account_id: CM_ACCOUNT, product_token: 'tok-cm-0123456789' } },
  ]);
});

// Correction de revue : le verrou d'envoi tient jusqu'à la fin de la lecture du corps.
test('un second envoi pendant la lecture de la réponse est refusé', async () => {
  let finish: () => void = () => undefined;
  const calls = stubFetch(() => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        finish = () => {
          controller.enqueue(new TextEncoder().encode(JSON.stringify(created)));
          controller.close();
        };
      },
    });
    return new Response(body, { status: 201, headers: { 'content-type': 'application/json' } });
  });
  const { onCreated } = renderForm();
  await fillMeta();
  await submit();
  await waitFor(() => expect(calls).toHaveLength(1));
  fireEvent.submit(screen.getByRole('button', { name: 'Vérification en cours…' }).closest('form') as HTMLFormElement);
  expect(calls).toHaveLength(1);
  finish();
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  expect(calls).toHaveLength(1);
});

// Correction de revue : carte grisée sans opacité sur le texte de la raison.
test('« Connexion Meta » grisée par le fond et la bordure, texte de la raison au contraste normal', () => {
  renderForm();
  const card = screen.getByRole('radio', { name: 'Connexion Meta' }).closest('label') as HTMLElement;
  expect(card.className).not.toMatch(/opacity/);
  expect(card.className).toMatch(/bg-surface-subtle/);
  expect(card.className).toMatch(/cursor-not-allowed/);
  expect(screen.getByText('En un clic avec Facebook. Pas encore disponible.').className).not.toMatch(/opacity/);
});

test('guide CM.com : documentation CM.com vérifiée et chemin du productToken', async () => {
  renderForm();
  await userEvent.click(screen.getByRole('radio', { name: /CM\.com/ }));
  expect(screen.getByRole('link', { name: /Ouvrir la documentation CM\.com/ })).toHaveAttribute('href', 'https://developers.cm.com/messaging/docs/channels-authentication');
  expect(screen.getByText(/API Access and Settings/)).toHaveTextContent('Authentication');
});

test('guide Meta : lien vers les paramètres Meta Business', () => {
  renderForm();
  expect(screen.getByRole('link', { name: /Ouvrir les paramètres Meta Business/ })).toHaveAttribute('href', 'https://business.facebook.com/latest/settings');
});
