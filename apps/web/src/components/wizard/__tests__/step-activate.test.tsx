import { useState } from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, test, expect } from 'vitest';
import { StepActivate } from '../step-activate';
import type { WizardState } from '@/lib/bot-draft';
import fr from '../../../../messages/fr.json';
import en from '../../../../messages/en.json';
import { accountView, numberView } from '@/components/connections/__tests__/fixtures';
import { describedBy, engineError, isReadableMuted, json, renderIntl, stubFetch, type Call } from '@/components/connections/__tests__/helpers';

// Le vrai Link préfixe la langue (/fr/...) ; ici on contrôle la cible brute et les attributs transmis.
vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

beforeEach(() => vi.restoreAllMocks());

const state: WizardState = {
  name: 'Conseil beauté Marais v2', slug: 'conseil-beaute-marais-v2', languages: ['fr', 'en'], defaultLanguage: 'fr',
  perLang: { fr: { mode: 'guided', role: 'Conseiller', tones: [], objective: '', info: '', raw: '' } },
  welcomeEnabled: true, welcome: {}, leadFields: [], entityId: 4,
};

const free = numberView({ id: 1, phone_e164: '+33612457890', display_name: 'Maison Lumière Marais' });
const sandbox = numberView({ id: 3, phone_e164: '+15550132291', display_name: 'Test Number', is_test: true });
/** Réponse de `POST /activate` : `BotDetail`, dont le statut et le numéro branché tels que le moteur les a écrits. */
const botDetail = (status: 'limited' | 'active', phone: string | null = '+33612457890') => ({
  bot_id: 'conseil-beaute-marais-v2',
  status,
  whatsapp_number: phone === null ? null : { id: 1, phone_e164: phone, display_name: 'Boutique', is_test: false, provider_state: 'present', quality: null, account: { id: 1, name: 'Compte', mode: 'meta_manual', state: 'connected', error_reason: null } },
});
const verifiedTwoMinutesAgo = (): string => new Date(Date.now() - 2 * 60_000).toISOString();

function accountsOf(...numbers: ReturnType<typeof numberView>[]) {
  return [accountView({ id: 1, name: 'Maison Lumière France', last_verified_at: verifiedTwoMinutesAgo(), numbers })];
}

type Props = React.ComponentProps<typeof StepActivate>;

function props(over: Partial<Props> = {}): Props {
  return {
    botId: 'conseil-beaute-marais-v2', numberId: 1, state, entries: [], onEntriesChange: vi.fn(), entityId: 4, entities: [{ id: 4, name: 'Boutique Paris Marais', status: 'active', bots: 1, members: 1 }],
    onBack: vi.fn(), onLater: vi.fn(), onActivated: vi.fn(), ...over,
  };
}

/** L'assistant tient la liste d'accès limité : le composant testé la reçoit et la remonte, comme dans `Wizard`. */
function Host(p: Props) {
  const [entries, setEntries] = useState<string[]>(p.entries);
  return <StepActivate {...p} entries={entries} onEntriesChange={(next) => { setEntries(next); p.onEntriesChange(next); }} />;
}

const activation = (calls: Call[]): Call[] => calls.filter((c) => c.method === 'POST');

async function ready(over: Partial<Props> = {}) {
  const p = props(over);
  renderIntl(<Host {...p} />);
  await screen.findByText('Compte WhatsApp connecté', { exact: false });
  return p;
}

async function addEntry(value: string) {
  await userEvent.type(screen.getByLabelText('Numéro à autoriser'), `${value}{Enter}`);
}

test('récapitulatif : agent IA, entité, langues, numéro entier, statut Brouillon, compteur 5 / 5', async () => {
  stubFetch(() => json(accountsOf(free)));
  await ready();
  expect(screen.getByText('5 / 5')).toBeInTheDocument();
  const recap = screen.getByRole('list', { name: 'Récapitulatif' });
  expect(within(recap).getByText('Conseil beauté Marais v2')).toBeInTheDocument();
  expect(within(recap).getByText('Boutique Paris Marais')).toBeInTheDocument();
  expect(within(recap).getByText('Français · English')).toBeInTheDocument();
  expect(within(recap).getByText('+33 6 12 45 78 90')).toBeInTheDocument();
  expect(within(recap).getByText('Brouillon')).toBeInTheDocument();
});

test('agent IA sans entité : la ligne Entité le dit (« Aucune entité »), elle n\'est pas omise', async () => {
  stubFetch(() => json(accountsOf(free)));
  await ready({ entityId: null });
  const recap = screen.getByRole('list', { name: 'Récapitulatif' });
  expect(within(recap).getByText('Entité')).toBeInTheDocument();
  expect(within(recap).getByText('Aucune entité')).toBeInTheDocument();
});

test('entité introuvable dans la liste (liste illisible, entité archivée) : « Entité non disponible », jamais le numéro d\'entité', async () => {
  stubFetch(() => json(accountsOf(free)));
  await ready({ entityId: 99 });
  const recap = screen.getByRole('list', { name: 'Récapitulatif' });
  expect(within(recap).getByText('Entité non disponible')).toBeInTheDocument();
  expect(recap).not.toHaveTextContent('99');
});

test('contrôles relus : numéro libre, compte connecté « vérifié il y a 2 minutes », rappel de facturation avec lien', async () => {
  stubFetch(() => json(accountsOf(free)));
  await ready();
  const checks = screen.getByRole('list', { name: 'Contrôles avant activation' });
  expect(within(checks).getByText('Numéro libre, il sera branché sur cet agent IA.')).toBeInTheDocument();
  expect(within(checks).getByText(/Compte WhatsApp connecté, vérifié il y a 2 minutes/)).toBeInTheDocument();
  const billing = within(checks).getByRole('link', { name: /Vérifier le moyen de paiement/ });
  expect(billing).toHaveAttribute('href', 'https://business.facebook.com/billing_hub/');
  expect(billing).toHaveAttribute('target', '_blank');
  expect(billing).toHaveAttribute('rel', expect.stringContaining('noopener'));
});

test('numéro normal : « Activer en accès limité » désactivé avec sa raison tant que la liste est vide', async () => {
  stubFetch(() => json(accountsOf(free)));
  await ready();
  const button = screen.getByRole('button', { name: 'Activer en accès limité' });
  expect(button).toBeDisabled();
  const reason = screen.getByText('Ajoutez au moins un numéro à la liste d\'accès limité pour activer.');
  expect(button).toHaveAttribute('aria-describedby', reason.id);
  await addEntry('+33612345678');
  expect(button).toBeEnabled();
  expect(screen.queryByText('Ajoutez au moins un numéro à la liste d\'accès limité pour activer.')).not.toBeInTheDocument();
});

test('numéro normal : envoie number_id, status limited et la liste, puis onActivated avec le numéro E.164', async () => {
  const calls = stubFetch((c) => (c.method === 'POST' ? json(botDetail('limited')) : json(accountsOf(free))));
  const p = await ready();
  await addEntry('+33612345678');
  await userEvent.click(screen.getByRole('button', { name: 'Activer en accès limité' }));
  await waitFor(() => expect(p.onActivated).toHaveBeenCalledTimes(1));
  expect(p.onActivated).toHaveBeenCalledWith({ status: 'limited', phone: '+33612457890' });
  expect(activation(calls)).toEqual([
    { url: '/api/bots/conseil-beaute-marais-v2/activate', method: 'POST', body: { number_id: 1, expected_bot_id: null, status: 'limited', allowlist: ['+33612345678'] } },
  ]);
});

// revue 2b-3 M-3
test('le numéro et le statut de la confirmation viennent de la réponse du moteur, pas de la dernière lecture', async () => {
  // La lecture dit +33612457890 ; entre-temps le numéro a changé d'E.164 chez le fournisseur : le moteur répond le nouveau.
  stubFetch((c) => (c.method === 'POST' ? json(botDetail('limited', '+33699999999')) : json(accountsOf(free))));
  const p = await ready();
  await addEntry('+33612345678');
  await userEvent.click(screen.getByRole('button', { name: 'Activer en accès limité' }));
  await waitFor(() => expect(p.onActivated).toHaveBeenCalledTimes(1));
  expect(p.onActivated).toHaveBeenCalledWith({ status: 'limited', phone: '+33699999999' });
});

// revue 2b-3 M-3
test.each([
  ['sans numéro branché', botDetail('limited', null)],
  ['corps vide', {}],
  ['numéro illisible', { status: 'limited', whatsapp_number: { phone_e164: 33612457890 } }],
  ['numéro sans format E.164', { status: 'limited', whatsapp_number: { phone_e164: 'pas un numéro' } }],
  ['liste en guise de corps', []],
])('réponse du moteur illisible (%s) : onActivated reçoit phone null, jamais le numéro de la lecture', async (_label, body) => {
  stubFetch((c) => (c.method === 'POST' ? json(body) : json(accountsOf(free))));
  const p = await ready();
  await addEntry('+33612345678');
  await userEvent.click(screen.getByRole('button', { name: 'Activer en accès limité' }));
  await waitFor(() => expect(p.onActivated).toHaveBeenCalledTimes(1));
  expect(p.onActivated).toHaveBeenCalledWith({ status: 'limited', phone: null });
});

// revue 2b-3 M-3
test('réponse du moteur sans contenu (204) : confirmation sans numéro', async () => {
  stubFetch((c) => (c.method === 'POST' ? new Response(null, { status: 204 }) : json(accountsOf(free))));
  const p = await ready();
  await addEntry('+33612345678');
  await userEvent.click(screen.getByRole('button', { name: 'Activer en accès limité' }));
  await waitFor(() => expect(p.onActivated).toHaveBeenCalledWith({ status: 'limited', phone: null }));
});

test('numéro de test : bouton « Activer », statut active, liste vide acceptée', async () => {
  const calls = stubFetch((c) => (c.method === 'POST' ? json(botDetail('active', '+15550132291')) : json(accountsOf(sandbox))));
  const p = await ready({ numberId: 3 });
  expect(screen.queryByRole('button', { name: 'Activer en accès limité' })).not.toBeInTheDocument();
  const button = screen.getByRole('button', { name: 'Activer' });
  expect(button).toBeEnabled();
  await userEvent.click(button);
  await waitFor(() => expect(p.onActivated).toHaveBeenCalledWith({ status: 'active', phone: '+15550132291' }));
  expect(activation(calls)[0]?.body).toEqual({ number_id: 3, expected_bot_id: null, status: 'active', allowlist: [] });
});

test('numéro de test : la liste est facultative et dit pourquoi', async () => {
  stubFetch(() => json(accountsOf(sandbox)));
  await ready({ numberId: 3 });
  expect(screen.getByText(/facultative/)).toBeInTheDocument();
});

test('refus 409 du moteur : message en rouge, lien vers Connexions, onActivated non appelé, rien ne change', async () => {
  const calls = stubFetch((c) =>
    c.method === 'POST'
      ? engineError(409, 'CONFLICT', 'Le compte WhatsApp de ce numéro n\'est pas connecté.')
      : json(accountsOf(free)),
  );
  const p = await ready();
  await addEntry('+33612345678');
  await userEvent.click(screen.getByRole('button', { name: 'Activer en accès limité' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Le compte WhatsApp de ce numéro n\'est pas connecté.');
  expect(alert).toHaveClass('text-danger');
  const link = within(alert.parentElement as HTMLElement).getByRole('link', { name: /Ouvrir Connexions/ });
  expect(link).toHaveAttribute('href', '/organisation/connexions');
  expect(link).toHaveAttribute('target', '_blank');
  expect(p.onActivated).not.toHaveBeenCalled();
  // La liste saisie est conservée et le bouton redevient disponible.
  expect(screen.getByText('+33 6 12 34 56 78')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Activer en accès limité' })).toBeEnabled();
  // Les contrôles sont relus après le refus.
  expect(calls.filter((c) => c.method === 'GET').length).toBeGreaterThanOrEqual(2);
});

// revue 2b-3 M-1
test('numéro tenu par un autre agent IA à la lecture : son identifiant est envoyé comme détenteur attendu', async () => {
  const taken = numberView({ id: 1, phone_e164: '+33612457890', bot: { bot_id: 'vente', name: 'Vente en ligne', status: 'limited' } });
  const calls = stubFetch((c) => (c.method === 'POST' ? json(botDetail('limited')) : json(accountsOf(taken))));
  const p = await ready();
  await addEntry('+33612345678');
  await userEvent.click(screen.getByRole('button', { name: 'Activer en accès limité' }));
  await waitFor(() => expect(p.onActivated).toHaveBeenCalledTimes(1));
  expect(activation(calls)[0]?.body).toEqual({ number_id: 1, expected_bot_id: 'vente', status: 'limited', allowlist: ['+33612345678'] });
});

// revue 2b-3 M-1
test('numéro tenu par cet agent IA à la lecture : son propre identifiant est envoyé', async () => {
  const mine = numberView({ id: 1, phone_e164: '+33612457890', bot: { bot_id: 'conseil-beaute-marais-v2', name: 'Conseil', status: 'draft' } });
  const calls = stubFetch((c) => (c.method === 'POST' ? json(botDetail('limited')) : json(accountsOf(mine))));
  const p = await ready();
  await addEntry('+33612345678');
  await userEvent.click(screen.getByRole('button', { name: 'Activer en accès limité' }));
  await waitFor(() => expect(p.onActivated).toHaveBeenCalledTimes(1));
  expect(activation(calls)[0]?.body).toMatchObject({ expected_bot_id: 'conseil-beaute-marais-v2' });
});

// revue 2b-3 M-1
test('409 « Ce numéro a changé » : message du moteur, numéro relu, le nouveau détenteur est annoncé et envoyé au second essai', async () => {
  const stale = 'Ce numéro a changé depuis votre lecture : vérifiez la liste.';
  let activations = 0;
  const calls = stubFetch((c) => {
    if (c.method !== 'POST') {
      // Après le premier refus, la relecture voit le nouveau détenteur.
      return json(accountsOf(activations === 0 ? free : numberView({ id: 1, phone_e164: '+33612457890', bot: { bot_id: 'vente', name: 'Vente en ligne', status: 'limited' } })));
    }
    activations += 1;
    return activations === 1 ? engineError(409, 'CONFLICT', stale, [{ path: 'expected_bot_id', message: stale }]) : json(botDetail('limited'));
  });
  const p = await ready();
  await addEntry('+33612345678');
  await userEvent.click(screen.getByRole('button', { name: 'Activer en accès limité' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(stale);
  expect(await screen.findByText(/Vente en ligne/)).toBeInTheDocument();
  expect(p.onActivated).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Activer en accès limité' }));
  await waitFor(() => expect(p.onActivated).toHaveBeenCalledTimes(1));
  expect(activation(calls).map((c) => (c.body as { expected_bot_id: string | null }).expected_bot_id)).toEqual([null, 'vente']);
});

test('refus 400 avec détails par entrée : l\'erreur s\'affiche sous la deuxième ligne', async () => {
  stubFetch((c) =>
    c.method === 'POST'
      ? engineError(400, 'VALIDATION_ERROR', 'Requête invalide.', [{ path: 'allowlist.1', message: 'Numéro au format international (ex. +33612345678) ou identifiant WhatsApp attendu.' }])
      : json(accountsOf(free)),
  );
  const p = await ready();
  await addEntry('+33612345678');
  await addEntry('abc');
  await userEvent.click(screen.getByRole('button', { name: 'Activer en accès limité' }));
  const items = within(screen.getByRole('list', { name: 'Numéros autorisés' })).getAllByRole('listitem');
  await waitFor(() => expect(within(items[1]!).getByRole('alert')).toHaveTextContent('Numéro au format international'));
  expect(within(items[0]!).queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(p.onActivated).not.toHaveBeenCalled();
  // Corriger la liste efface les erreurs affichées.
  await userEvent.click(screen.getByRole('button', { name: 'Retirer abc' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('numéro devenu « retiré » à la relecture : contrôle en rouge, bouton désactivé avec sa raison', async () => {
  const removed = numberView({ id: 1, phone_e164: '+33612457890', provider_state: 'removed', removed_at: '2026-11-09T08:00:00Z' });
  stubFetch(() => json(accountsOf(removed)));
  const p = props();
  renderIntl(<Host {...p} />);
  const check = await screen.findByText('Ce numéro n\'est plus disponible chez le fournisseur.');
  expect(check).toHaveClass('text-danger');
  const button = screen.getByRole('button', { name: 'Activer en accès limité' });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute('aria-describedby', expect.stringContaining(screen.getByText('Choisissez un autre numéro pour activer.').id));
  expect(screen.getByRole('link', { name: /Ouvrir Connexions/ })).toHaveAttribute('href', '/organisation/connexions');
  expect(p.onActivated).not.toHaveBeenCalled();
});

test('numéro absent de la relecture : même refus, bouton désactivé', async () => {
  stubFetch(() => json(accountsOf(numberView({ id: 99 }))));
  renderIntl(<Host {...props()} />);
  expect(await screen.findByText('Ce numéro n\'est plus raccordé à l\'organisation.')).toHaveClass('text-danger');
  expect(screen.getByRole('button', { name: 'Activer en accès limité' })).toBeDisabled();
});

test('numéro pris par un autre agent IA : repris en connaissance de cause, nommé dans les contrôles', async () => {
  const taken = numberView({ id: 1, phone_e164: '+33612457890', bot: { bot_id: 'support-client', name: 'Support client', status: 'active' } });
  stubFetch(() => json(accountsOf(taken)));
  await ready();
  const checks = screen.getByRole('list', { name: 'Contrôles avant activation' });
  expect(within(checks).getByText(/Support client/)).toBeInTheDocument();
  expect(within(checks).getByText(/passera au statut Brouillon/)).toBeInTheDocument();
  await addEntry('+33612345678');
  expect(screen.getByRole('button', { name: 'Activer en accès limité' })).toBeEnabled();
});

test('numéro déjà branché sur cet agent IA : le contrôle le dit', async () => {
  const mine = numberView({ id: 1, bot: { bot_id: 'conseil-beaute-marais-v2', name: 'Conseil beauté Marais v2', status: 'draft' } });
  stubFetch(() => json(accountsOf(mine)));
  await ready();
  expect(screen.getByText('Numéro déjà branché sur cet agent IA.')).toBeInTheDocument();
});

test('compte en erreur : contrôle en rouge, lien vers Connexions, bouton désactivé avec la raison du moteur', async () => {
  stubFetch(() => json([accountView({ id: 1, state: 'error', error_reason: 'token_invalid', numbers: [free] })]));
  renderIntl(<Host {...props()} />);
  expect(await screen.findByText('Le compte WhatsApp est en erreur.')).toHaveClass('text-danger');
  expect(screen.getByRole('link', { name: /Ouvrir Connexions/ })).toHaveAttribute('href', '/organisation/connexions');
  await addEntry('+33612345678');
  const button = screen.getByRole('button', { name: 'Activer en accès limité' });
  expect(button).toBeDisabled();
  const reason = screen.getByText('Le compte WhatsApp de ce numéro n\'est pas connecté.');
  expect(button).toHaveAttribute('aria-describedby', reason.id);
});

test('compte retiré de WABAGENT (état disconnected) : contrôle en rouge, bouton désactivé avec la même raison', async () => {
  stubFetch(() => json([accountView({ id: 1, state: 'disconnected', numbers: [free] })]));
  renderIntl(<Host {...props()} />);
  expect(await screen.findByText('Le compte WhatsApp a été retiré de WABAGENT.')).toHaveClass('text-danger');
  expect(screen.getByRole('button', { name: 'Activer en accès limité' })).toBeDisabled();
  expect(screen.getByText('Le compte WhatsApp de ce numéro n\'est pas connecté.')).toBeInTheDocument();
});

test('une saisie non ajoutée bloque l\'activation et le dit', async () => {
  stubFetch(() => json(accountsOf(free)));
  await ready();
  await addEntry('+33612345678');
  await userEvent.type(screen.getByLabelText('Numéro à autoriser'), '+3369');
  const button = screen.getByRole('button', { name: 'Activer en accès limité' });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute('aria-describedby', screen.getByText('Ajoutez le numéro saisi avec « Ajouter » ou videz le champ.').id);
});

test('ORG_CHANGED : rien n\'est affiché, onActivated non appelé, aucune autre requête d\'écriture', async () => {
  const calls = stubFetch((c) =>
    c.method === 'POST' ? engineError(409, 'ORG_CHANGED', 'L\'organisation affichée a changé.') : json(accountsOf(free)),
  );
  const p = await ready();
  await addEntry('+33612345678');
  await userEvent.click(screen.getByRole('button', { name: 'Activer en accès limité' }));
  await waitFor(() => expect(activation(calls)).toHaveLength(1));
  await act(async () => { await Promise.resolve(); });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByText('L\'organisation affichée a changé.')).not.toBeInTheDocument();
  expect(p.onActivated).not.toHaveBeenCalled();
  expect(activation(calls)).toHaveLength(1);
});

test('pendant l\'envoi : le bouton est désactivé (pas de double activation)', async () => {
  let release: (r: Response) => void = () => {};
  const calls = stubFetch((c) => (c.method === 'POST' ? new Promise<Response>((resolve) => { release = resolve; }) : json(accountsOf(free))));
  const p = await ready();
  await addEntry('+33612345678');
  await userEvent.click(screen.getByRole('button', { name: 'Activer en accès limité' }));
  const busy = await screen.findByRole('button', { name: 'Activation…' });
  expect(busy).toBeDisabled();
  await userEvent.click(busy);
  expect(activation(calls)).toHaveLength(1);
  await act(async () => { release(json({ status: 'limited' })); });
  await waitFor(() => expect(p.onActivated).toHaveBeenCalledTimes(1));
});

// revue finale 2b-3 m-10 : garde de double envoi par une référence, comme les autres fenêtres (l'état n'est pas encore rendu)
test('deux clics dans le même tour : une seule activation envoyée', async () => {
  const calls = stubFetch((c) => (c.method === 'POST' ? new Promise<Response>(() => undefined) : json(accountsOf(free))));
  await ready();
  await addEntry('+33612345678');
  const button = screen.getByRole('button', { name: 'Activer en accès limité' });
  await act(async () => {
    button.click();
    button.click();
  });
  expect(activation(calls)).toHaveLength(1);
});

test('« Changer de numéro » et « Laisser en brouillon » appellent leurs rappels sans écrire', async () => {
  const calls = stubFetch(() => json(accountsOf(free)));
  const p = await ready();
  await userEvent.click(screen.getByRole('button', { name: /Changer de numéro/ }));
  expect(p.onBack).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Laisser en brouillon' }));
  expect(p.onLater).toHaveBeenCalledTimes(1);
  expect(activation(calls)).toEqual([]);
});

test('lecture des numéros en échec : message, « Réessayer » relit, activation impossible entre-temps', async () => {
  let fail = true;
  stubFetch(() => (fail ? new Response('boom', { status: 500 }) : json(accountsOf(free))));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  renderIntl(<Host {...props()} />);
  expect(await screen.findByText('Impossible de relire le numéro WhatsApp.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Activer en accès limité' })).toBeDisabled();
  fail = false;
  await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByText(/Compte WhatsApp connecté/)).toBeInTheDocument();
});

test('le retour sur l\'onglet relit le numéro : un numéro retiré entre-temps passe en rouge', async () => {
  let removed = false;
  stubFetch(() => json(accountsOf(removed ? numberView({ id: 1, provider_state: 'removed' }) : free)));
  await ready();
  removed = true;
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(await screen.findByText('Ce numéro n\'est plus disponible chez le fournisseur.')).toBeInTheDocument();
});

test('refus 404 du moteur : son message en rouge et le lien vers Connexions', async () => {
  stubFetch((c) =>
    c.method === 'POST' ? engineError(404, 'NOT_FOUND', 'Agent IA ou numéro WhatsApp introuvable.') : json(accountsOf(free)),
  );
  const p = await ready();
  await addEntry('+33612345678');
  await userEvent.click(screen.getByRole('button', { name: 'Activer en accès limité' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Agent IA ou numéro WhatsApp introuvable.');
  expect(within(alert.parentElement as HTMLElement).getByRole('link', { name: /Ouvrir Connexions/ })).toHaveAttribute('href', '/organisation/connexions');
  expect(p.onActivated).not.toHaveBeenCalled();
});

test('un refus sans détail par entrée n\'a pas de lien vers Connexions (400 sur la liste entière)', async () => {
  stubFetch((c) =>
    c.method === 'POST' ? engineError(400, 'VALIDATION_ERROR', '20 entrées au plus.', [{ path: 'allowlist', message: '20 entrées au plus.' }]) : json(accountsOf(free)),
  );
  await ready();
  await addEntry('+33612345678');
  await userEvent.click(screen.getByRole('button', { name: 'Activer en accès limité' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('20 entrées au plus.');
  expect(screen.queryByRole('link', { name: /Ouvrir Connexions/ })).not.toBeInTheDocument();
});

test('le refus affiché disparaît quand une relecture remet les contrôles au vert (compte reconnecté)', async () => {
  let account: 'error' | 'connected' = 'connected';
  stubFetch((c) =>
    c.method === 'POST'
      ? (account = 'error', engineError(409, 'CONFLICT', 'Le compte WhatsApp de ce numéro n\'est pas connecté.'))
      : json([accountView({ id: 1, state: account, last_verified_at: verifiedTwoMinutesAgo(), numbers: [free] })]),
  );
  await ready();
  await addEntry('+33612345678');
  await userEvent.click(screen.getByRole('button', { name: 'Activer en accès limité' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('n\'est pas connecté');
  // La relecture après le refus montre le compte en erreur : le bouton est bloqué, le refus reste.
  await screen.findByText('Le compte WhatsApp est en erreur.');
  expect(screen.getByRole('alert')).toBeInTheDocument();
  // Compte reconnecté dans l'autre onglet : retour sur l'onglet, contrôles au vert, plus de refus affiché.
  account = 'connected';
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Activer en accès limité' })).toBeEnabled();
});

test('la liste saisie qui arrive de l\'assistant est reprise telle quelle', async () => {
  stubFetch(() => json(accountsOf(free)));
  await ready({ entries: ['+33612345678'] });
  expect(screen.getByText('+33 6 12 34 56 78')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Activer en accès limité' })).toBeEnabled();
});

// revue finale 2b-3 (contraste)
test('contraste : la raison de « Activer » désactivé (liste vide) est en text-muted', async () => {
  stubFetch(() => json(accountsOf(free)));
  await ready();
  expect(isReadableMuted(describedBy(screen.getByRole('button', { name: 'Activer en accès limité' })))).toBe(true);
});

// Tâche 16b (défauts D-1 et D-2 de la tâche 16) : le refus de l'activation est lu par describeFailure.
// audit R-14
test.each(['fr', 'en'] as const)('panne 500 (%s) : « Activation impossible. Réessayez. » et la référence, jamais « Erreur interne. »', async (locale) => {
  stubFetch((c) =>
    c.method === 'POST'
      ? json({ error: { code: 'INTERNAL', message: 'Erreur interne.', request_id: `req-wiz-${locale}` } }, 500)
      : json(accountsOf(sandbox)),
  );
  renderIntl(<Host {...props({ numberId: 3 })} />, locale);
  const messages = locale === 'fr' ? fr : en;
  const activateButton = await screen.findByRole('button', { name: messages.wizard.activate.activateTest });
  await waitFor(() => expect(activateButton).toBeEnabled());
  await userEvent.click(activateButton);
  const reference = await screen.findByText(messages.errors.generic.reference.replace('{reference}', `req-wiz-${locale}`));
  expect(reference.closest('[role="alert"]')).toHaveTextContent(messages.wizard.activate.activateFailed);
  expect(screen.queryByText('Erreur interne.')).not.toBeInTheDocument();
});

// audit R-15
test('anglais, transition.account_not_connected : le refus s\'affiche en anglais, jamais le texte français du moteur', async () => {
  const engineFrench = 'Le compte WhatsApp de ce numéro n\'est pas connecté.';
  stubFetch((c) =>
    c.method === 'POST'
      ? json({ error: { code: 'CONFLICT', message: engineFrench, reason: 'transition.account_not_connected' } }, 409)
      : json(accountsOf(sandbox)),
  );
  renderIntl(<Host {...props({ numberId: 3 })} />, 'en');
  const activateButton = await screen.findByRole('button', { name: en.wizard.activate.activateTest });
  await waitFor(() => expect(activateButton).toBeEnabled());
  await userEvent.click(activateButton);
  expect(await screen.findByRole('alert')).toHaveTextContent(en.errors.reasons.transition.account_not_connected);
  expect(screen.queryByText(engineFrench)).not.toBeInTheDocument();
});
