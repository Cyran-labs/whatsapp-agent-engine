import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import fr from '../../../../messages/fr.json';
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
  business_repointed: false,
};

const META_TOKEN = 'EAAG-jeton-long-1234567890';
const BUSINESS = '1270659448489249';
const MANAGER_WABA = '1122051030798254';
const MANAGER_URL = `https://business.facebook.com/latest/whatsapp_manager/overview/?business_id=${BUSINESS}&asset_id=${MANAGER_WABA}`;
const g = fr.connections.connectFlow.guideMeta;
const BUSINESS_FIELD = g.business.field;
const META_SECRET = 'a1b2c3d4e5f6a7b8c9d0';
const CM_ACCOUNT = '0b1f2d3c-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

function renderForm() {
  const onCreated = vi.fn();
  renderIntl(<ConnectForm onCreated={onCreated} />);
  return { onCreated };
}

async function pasteInto(label: string, text: string) {
  await userEvent.click(screen.getByLabelText(label));
  await userEvent.paste(text);
}

async function fillBusiness(value = BUSINESS) {
  await pasteInto(BUSINESS_FIELD, value);
}

async function fillMeta(waba = '104829371625544') {
  await fillBusiness();
  await userEvent.type(screen.getByLabelText('Nom du compte dans WABAGENT'), 'Boutique principale');
  await userEvent.type(screen.getByLabelText('ID du compte WhatsApp Business (WABA)'), waba);
  await userEvent.type(screen.getByLabelText("Jeton d'accès"), META_TOKEN);
  await userEvent.type(screen.getByLabelText("Secret de l'app"), META_SECRET);
}

const submit = () => userEvent.click(screen.getByRole('button', { name: 'Vérifier et raccorder' }));

// prototype 10 : élément à venir grisé, pastille Soon, bulle « Disponible prochainement : … » au survol et au focus
test('prototype 10 : deux modes au choix, « Connexion Meta » grisée, non choisissable, pastille « Soon » et bulle au focus', async () => {
  renderForm();
  const group = screen.getByRole('radiogroup', { name: 'Mode de raccordement' });
  const meta = within(group).getByRole('radio', { name: /API Meta directe/ });
  const cm = within(group).getByRole('radio', { name: /CM\.com/ });
  expect(within(group).getAllByRole('radio')).toHaveLength(2);
  const embedded = within(group).getByRole('group', { name: 'Connexion Meta' });
  expect(embedded).toHaveAttribute('aria-disabled', 'true');
  expect(within(embedded).getByText('Soon')).toBeInTheDocument();
  expect(within(embedded).getByText('En un clic avec Facebook.')).toBeInTheDocument();
  expect(group).not.toHaveTextContent('Bientôt');
  expect(group).not.toHaveTextContent('Pas encore disponible');
  expect(meta).toBeChecked();
  await userEvent.click(embedded);
  expect(meta).toBeChecked();
  const bubble = document.getElementById(embedded.getAttribute('aria-describedby') ?? '');
  expect(bubble).toBeVisible();
  expect(embedded).toHaveAccessibleDescription('Disponible prochainement : le raccordement en un clic avec Facebook.');
  expect(cm).toBeEnabled();
});

test('prérequis, guide Meta et encart du numéro dédié', async () => {
  renderForm();
  // spec R1 §6.1 : la vérification d'entreprise est recommandée, plus un prérequis.
  expect(screen.getByText(/portefeuille Meta Business au nom de votre entreprise/)).toBeInTheDocument();
  // Spec R2a §5.1 : l'étape 1 est le portefeuille, puis le choix du chemin.
  expect(screen.getByRole('list', { name: g.business.title })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: new RegExp(g.paths.existing.title) })).toBeChecked();
  await fillBusiness();
  await userEvent.click(screen.getByRole('radio', { name: new RegExp(g.paths.scratch.title) }));
  expect(screen.getByText("Créer l'app Meta avec le cas d'usage WhatsApp")).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Ouvrir le guide pas à pas de Meta/ })).toHaveAttribute('target', '_blank');
  expect(screen.getByText(/Le numéro de test suffit pour essayer/)).toBeInTheDocument();
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

// Spec R2a §5.1 : l'étape du portefeuille est obligatoire ; rien n'est envoyé sans portefeuille reconnu.
test('sans portefeuille : message sous le champ du portefeuille, focus, aucun appel', async () => {
  const calls = stubFetch(() => json({}));
  const { onCreated } = renderForm();
  await submit();
  const field = screen.getByLabelText(BUSINESS_FIELD);
  expect(field).toHaveAttribute('aria-invalid', 'true');
  expect(field).toHaveAccessibleDescription(new RegExp(g.business.required.replace(/[.()…]/g, '\\$&')));
  expect(field).toHaveFocus();
  await pasteInto(BUSINESS_FIELD, 'business.facebook.com/latest/settings/business_info?business_id=1270659448489249');
  await submit();
  expect(field).toHaveAccessibleDescription(new RegExp(g.business.unrecognised.replace(/[.()…]/g, '\\$&')));
  expect(calls).toEqual([]);
  expect(onCreated).not.toHaveBeenCalled();
});

test('Meta : champs vides bloqués, un message par champ', async () => {
  const calls = stubFetch(() => json({}));
  renderForm();
  await fillBusiness();
  await submit();
  expect(screen.getByLabelText(BUSINESS_FIELD)).not.toHaveAttribute('aria-invalid');
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
      body: { mode: 'meta_manual', name: 'Boutique principale', business_id: BUSINESS, waba_id: '104829371625544', access_token: META_TOKEN, app_secret: META_SECRET },
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

// audit décisions A19 : un contrôle en échec qui désigne un champ affiché marque aussi ce champ, la liste reste
test('422 dont un contrôle désigne un champ affiché (secret de l\'app) : liste gardée, champ marqué et focus', async () => {
  stubFetch(() => engineError(422, 'WA_VALIDATION_FAILED', 'Vérification du compte impossible.', [
    { path: 'app_secret', message: "Secret de l'app refusé" },
  ], 'whatsapp_account.verification_failed'));
  renderForm();
  await fillMeta();
  await submit();
  const list = await screen.findByRole('list', { name: 'Contrôles de vérification' });
  expect(within(list).getByText("Secret de l'app refusé")).toBeInTheDocument();
  const secret = screen.getByLabelText("Secret de l'app");
  expect(secret).toHaveAttribute('aria-invalid', 'true');
  expect(secret).toHaveFocus();
  expect(secret).toHaveAccessibleDescription(/Refusé par le fournisseur : voir les contrôles de vérification ci-dessous\./);
  expect(screen.getByLabelText("Jeton d'accès")).not.toHaveAttribute('aria-invalid');
  expect(screen.getByLabelText('ID du compte WhatsApp Business (WABA)')).not.toHaveAttribute('aria-invalid');
});

// audit décisions A19 : le contrôle du jeton désigne le champ « Jeton d'accès » ; le premier champ dans l'ordre de l'écran prend le focus
test('422 jeton et secret refusés : les deux champs marqués, focus sur le jeton ; un contrôle sans champ (WABA) n\'en marque aucun', async () => {
  stubFetch(() => engineError(422, 'WA_VALIDATION_FAILED', 'Vérification du compte impossible.', [
    { path: 'app_secret', message: "Secret de l'app refusé" },
    { path: 'token', message: 'Jeton refusé par Meta' },
    { path: 'waba_access', message: 'Ce WABA ID est introuvable ou inaccessible avec ce jeton.' },
  ]));
  renderForm();
  await fillMeta();
  await submit();
  await screen.findByRole('list', { name: 'Contrôles de vérification' });
  expect(screen.getByLabelText("Jeton d'accès")).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText("Jeton d'accès")).toHaveFocus();
  expect(screen.getByLabelText("Secret de l'app")).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('ID du compte WhatsApp Business (WABA)')).not.toHaveAttribute('aria-invalid');
});

// recette 3.14 : identifiant d'un numéro saisi à la place d'une WABA, le texte du moteur dit quoi reprendre, sous le contrôle
test('422 identifiant qui n\'est pas une WABA : le texte du moteur affiché en clair sous le contrôle « Compte WhatsApp (WABA) »', async () => {
  const NOT_A_WABA = "Cet identifiant n'est pas celui d'un compte WhatsApp Business (WABA). Reprenez l'identifiant du compte WhatsApp Business dans le Gestionnaire WhatsApp, pas celui d'un numéro ni de l'app.";
  stubFetch(() => engineError(422, 'WA_VALIDATION_FAILED', 'Vérification du compte impossible.', [{ path: 'waba_access', message: NOT_A_WABA }], 'whatsapp_account.verification_failed'));
  renderForm();
  await fillMeta('1095731283613082');
  await submit();
  const list = await screen.findByRole('list', { name: 'Contrôles de vérification' });
  const item = within(list).getByRole('listitem');
  expect(item).toHaveTextContent(/^✗Compte WhatsApp \(WABA\)/);
  expect(item).toHaveTextContent(NOT_A_WABA);
  expect(item.querySelector('details')).toBeNull();
  expect(screen.getByLabelText('ID du compte WhatsApp Business (WABA)')).toHaveValue('1095731283613082');
});

test('interface anglaise, 422 secret refusé : texte du champ traduit, aucun texte français sous le champ', async () => {
  stubFetch(() => engineError(422, 'WA_VALIDATION_FAILED', 'Vérification du compte impossible.', [{ path: 'app_secret', message: "Secret de l'app refusé" }]));
  renderIntl(<ConnectForm onCreated={vi.fn()} />, 'en');
  await pasteInto(en.connections.connectFlow.guideMeta.business.field, BUSINESS);
  await userEvent.type(screen.getByLabelText('Account name in WABAGENT'), 'Main shop');
  await userEvent.type(screen.getByLabelText('WhatsApp Business account ID (WABA)'), '104829371625544');
  await userEvent.type(screen.getByLabelText('Access token'), META_TOKEN);
  await userEvent.type(screen.getByLabelText('App secret'), META_SECRET);
  await userEvent.click(screen.getByRole('button', { name: 'Verify and connect' }));
  await screen.findByRole('list', { name: 'Verification checks' });
  expect(screen.getByLabelText('App secret')).toHaveAccessibleDescription('Refused by the provider: see the verification checks below.');
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
  expect(screen.queryByText("Créer l'app Meta avec le cas d'usage WhatsApp")).not.toBeInTheDocument();
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
  await pasteInto(en.connections.connectFlow.guideMeta.business.field, BUSINESS);
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
test('« Connexion Meta » grisée par le fond et la bordure, texte au contraste normal', () => {
  renderForm();
  const card = screen.getByRole('group', { name: 'Connexion Meta' });
  expect(card.className).not.toMatch(/opacity/);
  expect(card.className).toMatch(/bg-surface-subtle/);
  expect(card.className).toMatch(/cursor-not-allowed/);
  expect(screen.getByText('En un clic avec Facebook.').className).not.toMatch(/opacity/);
});

test('guide CM.com : documentation CM.com vérifiée et chemin du productToken', async () => {
  renderForm();
  await userEvent.click(screen.getByRole('radio', { name: /CM\.com/ }));
  expect(screen.getByRole('link', { name: /Ouvrir la documentation CM\.com/ })).toHaveAttribute('href', 'https://developers.cm.com/messaging/docs/channels-authentication');
  expect(screen.getByText(/API Access and Settings/)).toHaveTextContent('Authentication');
});

test('guide Meta : lien vers les paramètres Meta Business', () => {
  renderForm();
  const links = screen.getAllByRole('link', { name: /Ouvrir les paramètres Meta Business/ });
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) expect(link).toHaveAttribute('href', 'https://business.facebook.com/latest/settings');
});

// revue finale 2b-3 (contraste)
test('contraste : les indices des champs du raccordement sont en text-muted', () => {
  renderForm();
  const hints = Array.from(document.querySelectorAll('[id$="-hint"]'));
  expect(hints.length).toBeGreaterThan(0);
  for (const hint of hints) expect([hint.textContent, hint.classList.contains('text-muted') && !hint.classList.contains('text-muted-2')]).toEqual([hint.textContent, true]);
});

// contre-audit D-3 : après un refus de champ du moteur, le focus va au premier champ en erreur.
test('contre-audit D-3 : refus du moteur sur un champ : le focus va à ce champ', async () => {
  stubFetch(() => engineError(400, 'VALIDATION_ERROR', 'Données invalides.', [
    { path: 'access_token', message: 'Saisissez la valeur complète : une valeur masquée n\'est pas acceptée.' },
    { path: 'name', message: 'Nom déjà utilisé.' },
  ]));
  renderForm();
  await fillMeta();
  await submit();
  await screen.findByText('Nom déjà utilisé.');
  // Premier champ en erreur dans l'ordre de l'écran : le jeton (étape 5), avant le nom (étape 7, lot R2a).
  await waitFor(() => expect(screen.getByLabelText("Jeton d'accès")).toHaveFocus());
});

// recette du 12 nov. 2026 (remarques du bilan) : l'erreur du raccordement s'affichait sous le formulaire, hors de l'écran.
// Sans champ refusé, la zone d'erreur (message et contrôles) est amenée à l'écran et prend le focus.
test.each([
  ['422 sans champ (WABA)', () => engineError(422, 'WA_VALIDATION_FAILED', 'Meta a refusé le compte.', [{ path: 'waba_access', message: "Ce n'est pas une WABA" }])],
  ['409', () => engineError(409, 'CONFLICT', 'Ce compte WhatsApp ne peut pas être raccordé.')],
])('%s : zone d\'erreur amenée à l\'écran (défilement) et focus sur elle', async (_name, answer) => {
  const scroll = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll });
  stubFetch(answer);
  renderForm();
  await fillMeta();
  await submit();
  const alert = await screen.findByRole('alert');
  const zone = alert.closest('[data-connect-failure]') as HTMLElement;
  expect(zone).not.toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(zone));
  expect(zone).toHaveAttribute('tabindex', '-1');
  expect(scroll).toHaveBeenCalled();
  expect(scroll.mock.contexts.at(-1)).toBe(zone);
});

// contre-audit D-3 : un champ refusé garde le focus ; la zone d'erreur n'est pas focalisée à sa place
test('422 qui désigne un champ : le focus reste sur le champ refusé', async () => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  stubFetch(() => engineError(422, 'WA_VALIDATION_FAILED', 'Secret refusé.', [{ path: 'app_secret', message: 'Secret incorrect' }]));
  renderForm();
  await fillMeta();
  await submit();
  await screen.findByRole('alert');
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Secret de l'app")));
});

// Spec R2a §5.1, point 2, et maquette 01 : la suite du guide est grisée tant que le portefeuille n'est pas reconnu.
test('guide : suite grisée sans portefeuille, active une fois le portefeuille reconnu', async () => {
  renderForm();
  const waba = screen.getByLabelText('ID du compte WhatsApp Business (WABA)');
  expect(waba).toBeDisabled();
  expect(screen.getByLabelText("Jeton d'accès")).toBeDisabled();
  expect(screen.getByLabelText('Nom du compte dans WABAGENT')).toBeDisabled();
  expect(screen.getByText(g.locked)).toBeInTheDocument();
  await fillBusiness();
  expect(waba).toBeEnabled();
  expect(screen.getByLabelText("Jeton d'accès")).toBeEnabled();
  expect(screen.queryByText(g.locked)).not.toBeInTheDocument();
  // Liens précis du portefeuille reconnu (metaLinks).
  expect(screen.getByRole('link', { name: g.waba.linkPrecise })).toHaveAttribute(
    'href', `https://business.facebook.com/latest/settings/whatsapp_business_presence/?business_id=${BUSINESS}`,
  );
});

// Spec R2a §5.1, point 2 : un seul collage d'une adresse de WhatsApp Manager donne le portefeuille et la WABA.
test('guide : collage d\'une adresse WhatsApp Manager, chemin 1 et WABA préremplis', async () => {
  const calls = stubFetch(() => json(created, 201));
  const { onCreated } = renderForm();
  await fillBusiness('1234567890');
  await userEvent.click(screen.getByRole('radio', { name: new RegExp(g.paths.scratch.title) }));
  await userEvent.clear(screen.getByLabelText(BUSINESS_FIELD));
  await fillBusiness(MANAGER_URL);
  expect(screen.getByRole('radio', { name: new RegExp(g.paths.existing.title) })).toBeChecked();
  expect(screen.getByLabelText('ID du compte WhatsApp Business (WABA)')).toHaveValue(MANAGER_WABA);
  expect(screen.getByRole('status')).toHaveTextContent(g.business.recognised.replace('{business}', BUSINESS));
  expect(screen.getByRole('link', { name: g.number.linkPrecise })).toHaveAttribute(
    'href', `https://business.facebook.com/latest/whatsapp_manager/phone_numbers/?business_id=${BUSINESS}&asset_id=${MANAGER_WABA}`,
  );
  await userEvent.type(screen.getByLabelText("Jeton d'accès"), META_TOKEN);
  await userEvent.type(screen.getByLabelText("Secret de l'app"), META_SECRET);
  await userEvent.type(screen.getByLabelText('Nom du compte dans WABAGENT'), 'Boutique principale');
  await submit();
  await waitFor(() => expect(onCreated).toHaveBeenCalled());
  expect(calls[0]?.body).toEqual({
    mode: 'meta_manual', name: 'Boutique principale', business_id: BUSINESS, waba_id: MANAGER_WABA, access_token: META_TOKEN, app_secret: META_SECRET,
  });
});

test('collage d\'une adresse WhatsApp Manager : une WABA saisie à la main est remplacée par celle de l\'adresse', async () => {
  renderForm();
  await fillBusiness();
  await userEvent.type(screen.getByLabelText('ID du compte WhatsApp Business (WABA)'), '104829371625544');
  await userEvent.clear(screen.getByLabelText(BUSINESS_FIELD));
  await fillBusiness(MANAGER_URL);
  expect(screen.getByLabelText('ID du compte WhatsApp Business (WABA)')).toHaveValue(MANAGER_WABA);
});

// Spec R2a §5.1, point 5 (maquette 03, chemin 2) : le champ WABA accepte l'adresse de sa page et en extrait asset_id.
test('champ WABA : adresse de la page du compte collée, asset_id envoyé', async () => {
  const calls = stubFetch(() => json(created, 201));
  renderForm();
  await fillMeta(MANAGER_URL);
  expect(screen.getByLabelText('ID du compte WhatsApp Business (WABA)')).toHaveAccessibleDescription(
    new RegExp(fr.connections.connectFlow.fields.wabaFromAddress.replace('{waba}', MANAGER_WABA)),
  );
  await submit();
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0]?.body).toMatchObject({ waba_id: MANAGER_WABA, business_id: BUSINESS });
});

// Spec R2a §5.1, point 6 : le refus nomme le portefeuille lu chez Meta (détail business_found) ; texte composé dans
// l'écran avec une clé à arguments (le texte de la raison se lit sans argument, garde error-reasons.test.ts).
test.each(['fr', 'en'] as const)('résultat : business_mismatch nomme le portefeuille lu (%s)', async (locale) => {
  stubFetch(() => json({ error: {
    code: 'WA_VALIDATION_FAILED', message: 'Texte du moteur.', reason: 'whatsapp_account.business_mismatch',
    details: [{ path: 'business_found', message: 'Texte du moteur.', business: { id: '9876543210', name: 'Autre Portefeuille' } }],
  } }, 422));
  const m = locale === 'fr' ? fr : en;
  renderIntl(<ConnectForm onCreated={vi.fn()} />, locale);
  const f = m.connections.connectFlow.fields;
  await pasteInto(m.connections.connectFlow.guideMeta.business.field, BUSINESS);
  await userEvent.type(screen.getByLabelText(f.wabaId), '104829371625544');
  await userEvent.type(screen.getByLabelText(f.accessToken), META_TOKEN);
  await userEvent.type(screen.getByLabelText(f.appSecret), META_SECRET);
  await userEvent.type(screen.getByLabelText(f.name), 'Boutique principale');
  await userEvent.click(screen.getByRole('button', { name: m.connections.connectFlow.submit }));
  const expected = m.connections.connectFlow.errors.businessMismatch.replace('{name}', 'Autre Portefeuille').replace('{id}', '9876543210');
  expect(await screen.findByRole('alert')).toHaveTextContent(expected);
  expect(screen.queryByText('Texte du moteur.')).not.toBeInTheDocument();
  expect(screen.queryByRole('list', { name: m.connections.checks.listLabel })).not.toBeInTheDocument();
});

test('texte du refus business_mismatch : celui de la spec R2a §5.1', () => {
  expect(fr.connections.connectFlow.errors.businessMismatch).toBe(
    'Ce compte WhatsApp appartient au portefeuille {name} ({id}), pas à celui que vous avez saisi. Vérifiez le portefeuille ou le WABA ID.',
  );
});
