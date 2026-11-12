import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import type { MetaHealthView, WhatsAppWebhooksView } from '@wabagent/contracts';
import fr from '../../../../messages/fr.json';
import en from '../../../../messages/en.json';
import { AccountWebhooks } from '../account-webhooks';
import { accountView } from './fixtures';
import { engineError, json, renderIntl, stubFetch } from './helpers';

const w = fr.connections.webhooks;

beforeEach(() => {
  vi.restoreAllMocks();
});

function hooks(over: Partial<WhatsAppWebhooksView> = {}): WhatsAppWebhooksView {
  return { waba: 'ok', app: 'ok', app_host: null, checked_at: '2026-11-12T10:00:00.000Z', ...over };
}

function health(over: Partial<MetaHealthView> = {}): MetaHealthView {
  return { can_send: 'available', business_verification: 'verified', issues: [], read_at: '2026-11-12T10:00:00.000Z', ...over };
}

interface Opts {
  accountState?: 'connected' | 'error' | 'disconnected';
  webhooks?: WhatsAppWebhooksView | null;
  metaHealth?: MetaHealthView | null;
  isAdmin?: boolean;
  readOnly?: boolean;
  locale?: 'fr' | 'en';
}

function renderBox(opts: Opts = {}) {
  const onChanged = vi.fn();
  const onVerify = vi.fn();
  const view = renderIntl(
    <AccountWebhooks
      accountState={opts.accountState ?? 'connected'}
      webhooks={opts.webhooks === undefined ? hooks() : opts.webhooks}
      metaHealth={opts.metaHealth === undefined ? null : opts.metaHealth}
      accountId={7}
      isAdmin={opts.isAdmin ?? true}
      readOnly={opts.readOnly ?? false}
      onChanged={onChanged}
      onVerify={onVerify}
    />,
    opts.locale ?? 'fr',
  );
  return { ...view, onChanged, onVerify };
}

const ELSEWHERE = `Le webhook de votre app Meta pointe vers autre-produit.example.com : les alertes de compte de Meta n'arrivent pas à WABAGENT.`;

test('CM.com ou compte retiré (rien de lu chez Meta) : rien n\'est affiché', () => {
  const { container } = renderBox({ webhooks: null, metaHealth: null });
  expect(container).toBeEmptyDOMElement();
});

test('webhook de la WABA inscrit : « Webhook inscrit chez Meta. »', () => {
  renderBox();
  expect(screen.getByText(w.wabaOk)).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('webhook de la WABA absent : la phrase et « Vérifier maintenant » qui ouvre la vérification', async () => {
  const { onVerify } = renderBox({ webhooks: hooks({ waba: 'missing' }) });
  expect(screen.getByText(/Webhook absent chez Meta/).closest('[data-webhooks-line]')).toHaveTextContent('Webhook absent chez Meta : lancez Vérifier maintenant.');
  await userEvent.click(screen.getByRole('button', { name: w.verify }));
  expect(onVerify).toHaveBeenCalledTimes(1);
});

// Ruling R-6 : compte raccordé avant le lot R1, état jamais relu.
test('état du webhook inconnu (compte raccordé avant le lot) : « État du webhook inconnu : lancez Vérifier maintenant. »', () => {
  renderBox({ webhooks: hooks({ waba: 'unknown', app: 'unknown', checked_at: null }) });
  expect(screen.getByText(/État du webhook inconnu/).closest('[data-webhooks-line]')).toHaveTextContent('État du webhook inconnu : lancez Vérifier maintenant.');
  expect(screen.queryByText(w.wabaOk)).not.toBeInTheDocument();
});

test('app elsewhere : phrase avec le domaine et bouton « Faire pointer vers WABAGENT » pour un admin hors lecture seule', () => {
  renderBox({ webhooks: hooks({ app: 'elsewhere', app_host: 'autre-produit.example.com' }) });
  expect(screen.getByText(/pointe vers autre-produit/).closest('[data-webhooks-line]')).toHaveTextContent(ELSEWHERE);
  expect(screen.getByRole('button', { name: w.repoint })).toBeInTheDocument();
});

test.each([
  { who: 'non admin', isAdmin: false, readOnly: false },
  { who: 'admin en lecture seule', isAdmin: true, readOnly: true },
])('app elsewhere, $who : la phrase, sans bouton', ({ isAdmin, readOnly }) => {
  renderBox({ webhooks: hooks({ app: 'elsewhere', app_host: 'autre-produit.example.com' }), isAdmin, readOnly });
  expect(screen.getByText(/pointe vers autre-produit/).closest('[data-webhooks-line]')).toHaveTextContent(ELSEWHERE);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('non admin, webhook absent : la cause reste, le conseil est de prévenir un administrateur, sans bouton', () => {
  renderBox({ webhooks: hooks({ waba: 'missing' }), isAdmin: false });
  expect(screen.getByText(/Webhook absent chez Meta/).closest('[data-webhooks-line]')).toHaveTextContent(
    'Webhook absent chez Meta : prévenez un administrateur de votre organisation.',
  );
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('« Faire pointer vers WABAGENT » : confirmation qui répète le domaine, POST app-webhook, réussite dite et page relue', async () => {
  const calls = stubFetch(() => json({ ...accountView({ id: 7 }), webhooks: hooks(), checks: [{ key: 'webhook_app', status: 'created' }] }));
  const { onChanged } = renderBox({ webhooks: hooks({ app: 'elsewhere', app_host: 'autre-produit.example.com' }) });
  await userEvent.click(screen.getByRole('button', { name: w.repoint }));
  const dialog = screen.getByRole('dialog', { name: w.confirmTitle });
  expect(dialog).toHaveTextContent(
    "Le webhook de votre app Meta pointe aujourd'hui vers autre-produit.example.com. Il pointera vers WABAGENT : autre-produit.example.com ne recevra plus les événements de cette app Meta.",
  );
  expect(calls).toHaveLength(0);
  await userEvent.click(within(dialog).getByRole('button', { name: w.confirm }));
  expect(await within(dialog).findByText(w.repointed)).toBeInTheDocument();
  expect(calls).toEqual([{ url: '/api/whatsapp-accounts/7/app-webhook', method: 'POST', body: undefined }]);
  expect(onChanged).toHaveBeenCalledTimes(1);
});

test('confirmation : Annuler ferme sans rien envoyer', async () => {
  const calls = stubFetch(() => json({}));
  renderBox({ webhooks: hooks({ app: 'elsewhere', app_host: 'autre-produit.example.com' }) });
  await userEvent.click(screen.getByRole('button', { name: w.repoint }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: fr.connections.dialogs.cancel }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(calls).toHaveLength(0);
});

// Ruling R-15 : après un échec, l'état reste `elsewhere`, le bouton aussi. Audit des décisions R1 P-3 (A-5) : texte propre à
// cette fenêtre (« Réessayez » : seul ce bouton peut remplacer l'adresse, jamais « Vérifier maintenant »).
test('échec 422 app_webhook_failed : texte propre à la fenêtre, page non relue, bouton gardé', async () => {
  stubFetch(() =>
    json({ error: { code: 'WA_VALIDATION_FAILED', message: 'Texte du moteur.', reason: 'whatsapp_account.app_webhook_failed', request_id: 'req-app-1' } }, 422),
  );
  const { onChanged } = renderBox({ webhooks: hooks({ app: 'elsewhere', app_host: 'autre-produit.example.com' }) });
  await userEvent.click(screen.getByRole('button', { name: w.repoint }));
  const dialog = screen.getByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: w.confirm }));
  const alert = await within(dialog).findByRole('alert');
  expect(w.repointFailed).toBe("WABAGENT n'a pas pu inscrire le webhook de votre app Meta. Réessayez.");
  expect(alert).toHaveTextContent(w.repointFailed);
  expect(alert).not.toHaveTextContent(/Vérifier maintenant/);
  expect(screen.queryByText('Texte du moteur.')).not.toBeInTheDocument();
  expect(onChanged).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole('button', { name: fr.connections.dialogs.cancel }));
  expect(screen.getByRole('button', { name: w.repoint })).toBeInTheDocument();
});

// Audit des décisions R1 P-3 (A-5) : la cause est montrée repliée, détail du moteur ou message de Meta, comme dans la liste des
// contrôles.
test.each([
  ['détail du moteur', { path: 'webhook_app', message: 'Une autre opération est en cours sur ce compte WhatsApp, réessayez.' }, 'Une autre opération est en cours sur ce compte WhatsApp, réessayez.'],
  ['message de Meta', { path: 'webhook_app', message: "WABAGENT n'a pas pu lire ou inscrire le webhook de votre app Meta.", provider_text: '(#2200) Callback verification failed' }, '(#2200) Callback verification failed'],
])('échec 422 app_webhook_failed avec %s : affiché replié sous le texte de la fenêtre', async (_label, detail, shown) => {
  stubFetch(() => json({ error: {
    code: 'WA_VALIDATION_FAILED', message: 'Texte du moteur.', reason: 'whatsapp_account.app_webhook_failed', request_id: 'req-app-3', details: [detail],
  } }, 422));
  renderBox({ webhooks: hooks({ app: 'elsewhere', app_host: 'autre-produit.example.com' }) });
  await userEvent.click(screen.getByRole('button', { name: w.repoint }));
  const dialog = screen.getByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: w.confirm }));
  await within(dialog).findByRole('alert');
  const text = within(dialog).getByText(shown);
  expect(text.closest('details')).not.toBeNull();
});

// audit R-14 : une panne du moteur donne le texte contextuel et la référence de la requête.
test('panne 500 : texte contextuel et référence, jamais « Erreur interne. »', async () => {
  stubFetch(() => json({ error: { code: 'INTERNAL', message: 'Erreur interne.', request_id: 'req-app-2' } }, 500));
  renderBox({ webhooks: hooks({ app: 'elsewhere', app_host: 'autre-produit.example.com' }) });
  await userEvent.click(screen.getByRole('button', { name: w.repoint }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: w.confirm }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(fr.errors.generic.server);
  expect(alert).toHaveTextContent('req-app-2');
  expect(screen.queryByText('Erreur interne.')).not.toBeInTheDocument();
});

test('échec en anglais : texte anglais de la clé, jamais le français du moteur', async () => {
  stubFetch(() => engineError(422, 'WA_VALIDATION_FAILED', "La plateforme n'a pas d'adresse publique.", undefined, 'whatsapp_account.public_url_missing'));
  renderBox({ webhooks: hooks({ app: 'elsewhere', app_host: 'autre-produit.example.com' }), locale: 'en' });
  const e = en.connections.webhooks;
  await userEvent.click(screen.getByRole('button', { name: e.repoint }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: e.confirm }));
  expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.reasons.whatsapp_account.public_url_missing);
  expect(screen.queryByText(/adresse publique/)).not.toBeInTheDocument();
});

test('app failed : la phrase et « Vérifier maintenant »', async () => {
  const { onVerify } = renderBox({ webhooks: hooks({ app: 'failed' }) });
  expect(screen.getByText(/Webhook de l'app Meta non inscrit/).closest('[data-webhooks-line]')).toHaveTextContent(
    "Webhook de l'app Meta non inscrit : les alertes de compte de Meta n'arrivent pas à WABAGENT. Lancez Vérifier maintenant.",
  );
  await userEvent.click(screen.getByRole('button', { name: w.verify }));
  expect(onVerify).toHaveBeenCalledTimes(1);
});

test('sans onVerify (encart de l\'agent IA) : pas de bouton « Vérifier maintenant », la phrase reste', () => {
  renderIntl(<AccountWebhooks accountState="connected" webhooks={hooks({ waba: 'missing', app: 'failed' })} metaHealth={null} accountId={7} isAdmin readOnly />);
  expect(screen.getByText(/Webhook absent chez Meta/)).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('état Meta : envoi limité, cause 141010 traduite, lien vers le Centre de sécurité de Meta', () => {
  renderBox({ metaHealth: health({ can_send: 'limited', issues: [{ code: 141010, text: 'Business verification required.' }] }) });
  const line = screen.getByText(w.sendLimited).closest('[data-webhooks-line]') as HTMLElement;
  const causes = within(line).getByRole('list', { name: w.causesLabel });
  expect(within(causes).getByText(w.issue141010)).toBeInTheDocument();
  expect(within(line).queryByText('Business verification required.')).not.toBeInTheDocument();
  const link = within(line).getByRole('link', { name: w.verificationLink });
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});

test('état Meta : envoi bloqué en alerte, cause inconnue avec son code et le texte de Meta replié', () => {
  renderBox({ metaHealth: health({ can_send: 'blocked', issues: [{ code: 131999, text: 'Something Meta said.' }, { code: null, text: null }] }) });
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent(w.sendBlocked);
  expect(within(alert).getByText('Problème signalé par Meta (code 131999)')).toBeInTheDocument();
  expect(within(alert).getByText(w.issueUnknown)).toBeInTheDocument();
  const detail = within(alert).getByText('Something Meta said.');
  expect(detail.closest('details')).not.toBeNull();
  expect(within(alert).getByRole('link', { name: w.managerLink })).toHaveAttribute('target', '_blank');
});

test('état Meta : envoi possible sans cause : rien de plus que les webhooks', () => {
  renderBox({ metaHealth: health() });
  expect(screen.queryByText(w.sendLimited)).not.toBeInTheDocument();
  expect(screen.queryByText(w.issuesOnly)).not.toBeInTheDocument();
});

test('état Meta : envoi possible mais une cause signalée : « Meta signale un point à régler sur ce compte. »', () => {
  renderBox({ metaHealth: health({ issues: [{ code: 141010, text: null }] }) });
  expect(screen.getByText(w.issuesOnly)).toBeInTheDocument();
  expect(screen.getByText(w.issue141010)).toBeInTheDocument();
});

test('la réussite reste dite après la relecture qui enlève la ligne « pointe vers »', async () => {
  stubFetch(() => json({ ...accountView({ id: 7 }), checks: [] }));
  const props = { accountState: 'connected' as const, metaHealth: null, accountId: 7, isAdmin: true, readOnly: false, onChanged: vi.fn() };
  const withIntl = (ui: React.ReactNode) => <NextIntlClientProvider locale="fr" messages={fr}>{ui}</NextIntlClientProvider>;
  const { rerender } = renderIntl(<AccountWebhooks webhooks={hooks({ app: 'elsewhere', app_host: 'a.example.com' })} {...props} />);
  await userEvent.click(screen.getByRole('button', { name: w.repoint }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: w.confirm }));
  await waitFor(() => expect(props.onChanged).toHaveBeenCalled());
  rerender(withIntl(<AccountWebhooks webhooks={hooks()} {...props} />));
  expect(screen.getByRole('dialog')).toHaveTextContent(w.repointed);
});

// Comme DisconnectDialog : après ORG_CHANGED, la fenêtre revient à la confirmation (aucun envoi en cours affiché).
test('409 ORG_CHANGED : la fenêtre revient à la confirmation, rien d\'affiché, page non relue', async () => {
  stubFetch(() => engineError(409, 'ORG_CHANGED', "L'organisation a changé."));
  const { onChanged } = renderBox({ webhooks: hooks({ app: 'elsewhere', app_host: 'autre-produit.example.com' }) });
  await userEvent.click(screen.getByRole('button', { name: w.repoint }));
  const dialog = screen.getByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: w.confirm }));
  await waitFor(() => expect(within(dialog).getByRole('button', { name: w.confirm })).toBeEnabled());
  expect(within(dialog).queryByText(w.repointing)).not.toBeInTheDocument();
  expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  expect(onChanged).not.toHaveBeenCalled();
});

// relecture finale R1 FR-M3 : hors `connected`, l'état des webhooks n'est pas dit (le compte ne sert rien, le bandeau
// d'erreur dit la cause) et « Faire pointer vers WABAGENT » n'est pas proposé ; l'état lu chez Meta reste.
test.each(['error', 'disconnected'] as const)('compte %s : aucune ligne de webhook, ni « inscrit » en vert ni « Faire pointer »', (accountState) => {
  renderBox({ accountState, webhooks: hooks({ app: 'elsewhere', app_host: 'autre.example.com' }), metaHealth: health({ can_send: 'blocked' }) });
  expect(screen.queryByText(w.wabaOk)).not.toBeInTheDocument();
  expect(screen.queryByText(/autre\.example\.com/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: w.repoint })).not.toBeInTheDocument();
  expect(screen.getByText(/Meta bloque les envois de ce compte/)).toBeInTheDocument();
});

test('compte connecté : la ligne « inscrit » et « Faire pointer » restent', () => {
  renderBox({ webhooks: hooks({ app: 'elsewhere', app_host: 'autre.example.com' }) });
  expect(screen.getByText(w.wabaOk)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: w.repoint })).toBeInTheDocument();
});

// Audit des décisions R1 N-6 (A-8) : la date de lecture de l'état Meta est dite à côté de la ligne, une alerte périmée se voit.
test.each(['fr', 'en'] as const)('état lu chez Meta (%s) : date de lecture à côté de la ligne', (locale) => {
  const readAt = new Date(Date.now() - 3 * 86_400_000).toISOString();
  renderBox({ metaHealth: health({ can_send: 'limited', read_at: readAt }), locale });
  const m = locale === 'fr' ? fr : en;
  const line = screen.getByText(m.connections.webhooks.sendLimited).closest('[data-webhooks-line]');
  const when = line!.querySelector('[data-health-read-at]');
  expect(when).not.toBeNull();
  expect(when).toHaveTextContent(locale === 'fr' ? /il y a 3 jours/ : /3 days ago/);
  expect(when!.querySelector('time')).toHaveAttribute('dateTime', readAt);
});
