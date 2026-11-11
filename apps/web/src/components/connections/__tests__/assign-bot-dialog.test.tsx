import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { AssignBotDialog } from '../assign-bot-dialog';
import { numberView } from './fixtures';
import { describedBy, engineError, isReadableMuted, json, renderIntl, stubFetch, type Call } from './helpers';

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

const bots = [
  { bot_id: 'conseil', name: 'Conseil Marais', status: 'limited', whatsapp_number: { id: 1, phone_e164: '+33612457890' } },
  { bot_id: 'sav', name: 'SAV commandes', status: 'draft', whatsapp_number: null },
  { bot_id: 'vente', name: 'Vente en ligne', status: 'draft', whatsapp_number: { id: 9, phone_e164: '+33184801234' } },
];

function engine(overrides: (call: Call) => Response | undefined = () => undefined) {
  return stubFetch((call) => {
    const over = overrides(call);
    if (over) return over;
    if (call.url === '/api/bots') return json(bots);
    if (call.method === 'PUT') return json({ bot_id: 'sav' });
    return new Response('{}', { status: 404 });
  });
}

function renderDialog(number = numberView({ id: 2, phone_e164: '+33184801234', display_name: 'Boutique SAV' })) {
  const onClose = vi.fn();
  const onDone = vi.fn();
  const onStale = vi.fn();
  const view = renderIntl(<AssignBotDialog number={number} onClose={onClose} onDone={onDone} onStale={onStale} />);
  return { onClose, onDone, onStale, unmount: view.unmount };
}

test('liste les agents IA de l\'organisation (GET /api/bots) ; le choix envoie PUT /api/bots/<id>/number avec number_id', async () => {
  const calls = engine();
  const { onDone } = renderDialog();
  expect(await screen.findByRole('radio', { name: /SAV commandes/ })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: /Conseil Marais/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Brancher' })).toBeDisabled();
  await userEvent.click(screen.getByRole('radio', { name: /SAV commandes/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Brancher' }));
  await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  expect(calls.at(-1)).toEqual({ url: '/api/bots/sav/number', method: 'PUT', body: { number_id: 2, expected_bot_id: null } });
});

test('l\'identifiant de l\'agent IA est encodé dans le chemin', async () => {
  const calls = engine((call) => (call.url === '/api/bots' ? json([{ bot_id: 'a b/c', name: 'Étrange', status: 'draft', whatsapp_number: null }]) : undefined));
  renderDialog();
  await userEvent.click(await screen.findByRole('radio', { name: /Étrange/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Brancher' }));
  await waitFor(() => expect(calls.at(-1)?.method).toBe('PUT'));
  expect(calls.at(-1)?.url).toBe('/api/bots/a%20b%2Fc/number');
});

test('un agent IA qui a déjà un numéro est signalé : il perdra son numéro', async () => {
  engine();
  renderDialog();
  await screen.findByRole('radio', { name: /Vente en ligne/ });
  expect(screen.getByText(/perdra son numéro \+33 1 84 80 12 34/)).toBeInTheDocument();
  expect(screen.getByText(/perdra son numéro \+33 6 12 45 78 90/)).toBeInTheDocument();
});

// décision François A9
test('numéro branché sur un agent IA en accès limité ou actif : l\'avertissement le nomme et dit qu\'il passera en Désactivé', async () => {
  engine();
  renderDialog(numberView({ id: 1, bot: { bot_id: 'conseil', name: 'Conseil Marais', status: 'limited', status_reason: null, not_responding: null } }));
  await screen.findByRole('radio', { name: /SAV commandes/ });
  const warning = screen.getByRole('status');
  expect(warning).toHaveTextContent('Conseil Marais');
  expect(warning).toHaveTextContent(/passera Offline : il ne répondra plus/);
});

test('numéro branché sur un agent IA en brouillon : il le nomme sans parler de brouillon', async () => {
  engine();
  renderDialog(numberView({ id: 9, bot: { bot_id: 'vente', name: 'Vente en ligne', status: 'draft', status_reason: null, not_responding: null } }));
  await screen.findByRole('radio', { name: /SAV commandes/ });
  const warning = screen.getByRole('status');
  expect(warning).toHaveTextContent('Vente en ligne');
  expect(warning).not.toHaveTextContent(/Offline/);
});

test('l\'agent IA déjà branché sur ce numéro n\'est pas choisissable, avec sa raison', async () => {
  engine();
  renderDialog(numberView({ id: 1, bot: { bot_id: 'conseil', name: 'Conseil Marais', status: 'limited', status_reason: null, not_responding: null } }));
  const radio = await screen.findByRole('radio', { name: /Conseil Marais/ });
  expect(radio).toBeDisabled();
  expect(screen.getByText('Déjà branché sur ce numéro')).toBeInTheDocument();
});

test('refus du moteur affiché tel quel, la fenêtre reste ouverte et onDone n\'est pas appelé', async () => {
  engine((call) => (call.method === 'PUT' ? engineError(409, 'CONFLICT', 'Agent IA ou numéro WhatsApp introuvable.') : undefined));
  const { onDone } = renderDialog();
  await userEvent.click(await screen.findByRole('radio', { name: /SAV commandes/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Brancher' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Agent IA ou numéro WhatsApp introuvable.');
  expect(onDone).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('aucun agent IA dans l\'organisation : message et lien vers la création', async () => {
  engine((call) => (call.url === '/api/bots' ? json([]) : undefined));
  renderDialog();
  expect(await screen.findByText(/Aucun agent IA dans l'organisation/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Créer un agent IA/ })).toHaveAttribute('href', '/agents/new');
});

test('liste des agents IA illisible : message et « Réessayer »', async () => {
  let attempt = 0;
  engine((call) => {
    if (call.url !== '/api/bots') return undefined;
    attempt += 1;
    return attempt === 1 ? new Response('{}', { status: 500 }) : json(bots);
  });
  renderDialog();
  expect(await screen.findByRole('alert')).toHaveTextContent(/Impossible de charger les agents IA/);
  await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByRole('radio', { name: /SAV commandes/ })).toBeInTheDocument();
});

test('agent IA en accès limité qui a déjà un numéro : avertissement avant confirmation (statut gardé, nouveau numéro, ancien libéré)', async () => {
  engine();
  renderDialog();
  await userEvent.click(await screen.findByRole('radio', { name: /Conseil Marais/ }));
  const warning = screen.getByRole('status');
  expect(warning).toHaveTextContent(
    'Conseil Marais garde son statut « Preview » : il répondra tout de suite sur +33 1 84 80 12 34 aux numéros de sa Whitelist, et ne sera plus servi sur +33 6 12 45 78 90.',
  );
  expect(screen.getByRole('button', { name: 'Brancher' })).toHaveAccessibleDescription(/garde son statut/);
});

test('agent IA actif : le nouveau numéro sert tous les contacts', async () => {
  engine((call) => (call.url === '/api/bots'
    ? json([{ bot_id: 'actif', name: 'Boutique en ligne', status: 'active', whatsapp_number: { id: 7, phone_e164: '+33612457890' } }])
    : undefined));
  renderDialog();
  await userEvent.click(await screen.findByRole('radio', { name: /Boutique en ligne/ }));
  expect(screen.getByRole('status')).toHaveTextContent(/garde son statut « Online » : il répondra tout de suite sur .* à tous les contacts/);
});

test('agent IA en brouillon sans numéro ou avec numéro : pas d\'avertissement de statut conservé', async () => {
  engine();
  renderDialog();
  await userEvent.click(await screen.findByRole('radio', { name: /SAV commandes/ }));
  expect(screen.queryByText(/garde son statut/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('radio', { name: /Vente en ligne/ }));
  expect(screen.queryByText(/garde son statut/)).not.toBeInTheDocument();
});

// revue 2b-3 M-1
test('numéro vu libre : le détenteur attendu est null ; numéro vu tenu par un agent IA : son identifiant', async () => {
  const calls = engine();
  const first = renderDialog(numberView({ id: 2, bot: { bot_id: 'vente', name: 'Vente en ligne', status: 'limited', status_reason: null, not_responding: null } }));
  await userEvent.click(await screen.findByRole('radio', { name: /SAV commandes/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Brancher' }));
  await waitFor(() => expect(first.onDone).toHaveBeenCalledTimes(1));
  expect(calls.at(-1)).toEqual({ url: '/api/bots/sav/number', method: 'PUT', body: { number_id: 2, expected_bot_id: 'vente' } });
});

// revue 2b-3 M-1
test('409 « Ce numéro a changé » : message du moteur, la page relit sa liste (onStale), le choix est effacé, onDone non appelé', async () => {
  const stale = 'Ce numéro a changé depuis votre lecture : vérifiez la liste.';
  engine((call) => (call.method === 'PUT' ? engineError(409, 'CONFLICT', stale, [{ path: 'expected_bot_id', message: stale }]) : undefined));
  const { onDone, onStale } = renderDialog();
  await userEvent.click(await screen.findByRole('radio', { name: /SAV commandes/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Brancher' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(stale);
  expect(onStale).toHaveBeenCalledTimes(1);
  expect(onDone).not.toHaveBeenCalled();
  expect(screen.getByRole('radio', { name: /SAV commandes/ })).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Brancher' })).toBeDisabled();
});

// revue 2b-3 M-1
test('un autre refus 409 ou une erreur ne relit pas la liste', async () => {
  engine((call) => (call.method === 'PUT' ? engineError(409, 'CONFLICT', "Le compte WhatsApp de ce numéro n'est pas connecté.") : undefined));
  const { onStale } = renderDialog();
  await userEvent.click(await screen.findByRole('radio', { name: /SAV commandes/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Brancher' }));
  await screen.findByRole('alert');
  expect(onStale).not.toHaveBeenCalled();
});

// revue finale 2b-3 m-9 : la liste des agents IA se relit au retour sur l'onglet
function returnToTab() {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  return act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
}

test('retour sur l\'onglet : GET /api/bots est relu, un agent IA créé ailleurs apparaît', async () => {
  let created = false;
  const calls = engine((call) => (call.url === '/api/bots' && created ? json([...bots, { bot_id: 'neuf', name: 'Agent neuf', status: 'draft', whatsapp_number: null }]) : undefined));
  renderDialog();
  await screen.findByRole('radio', { name: /SAV commandes/ });
  expect(screen.queryByRole('radio', { name: /Agent neuf/ })).not.toBeInTheDocument();
  created = true;
  await returnToTab();
  expect(await screen.findByRole('radio', { name: /Agent neuf/ })).toBeInTheDocument();
  expect(calls.filter((c) => c.url === '/api/bots')).toHaveLength(2);
});

test('retour sur l\'onglet : l\'agent IA choisi n\'existe plus, le choix est effacé', async () => {
  let gone = false;
  engine((call) => (call.url === '/api/bots' && gone ? json(bots.filter((b) => b.bot_id !== 'sav')) : undefined));
  renderDialog();
  await userEvent.click(await screen.findByRole('radio', { name: /SAV commandes/ }));
  expect(screen.getByRole('button', { name: 'Brancher' })).toBeEnabled();
  gone = true;
  await returnToTab();
  await waitFor(() => expect(screen.queryByRole('radio', { name: /SAV commandes/ })).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Brancher' })).toBeDisabled();
});

test('retour sur l\'onglet : une relecture en échec garde la liste affichée', async () => {
  let fail = false;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  engine((call) => (call.url === '/api/bots' && fail ? new Response('{}', { status: 500 }) : undefined));
  renderDialog();
  await screen.findByRole('radio', { name: /SAV commandes/ });
  fail = true;
  await returnToTab();
  expect(screen.getByRole('radio', { name: /SAV commandes/ })).toBeInTheDocument();
  expect(screen.queryByText(/Impossible de charger les agents IA/)).not.toBeInTheDocument();
});

// revue finale 2b-3 m-9 : aria-describedby ne vise jamais un identifiant absent
test('bouton « Brancher » : aria-describedby vise toujours un élément présent (chargement, liste vide, échec, choix, avertissement)', async () => {
  const describedTargetExists = () => {
    const id = screen.getByRole('button', { name: 'Brancher' }).getAttribute('aria-describedby');
    return id === null || document.getElementById(id) !== null;
  };
  // chargement : aucune liste, aucun indice
  stubFetch(() => new Promise<Response>(() => undefined));
  const first = renderDialog();
  expect(describedTargetExists()).toBe(true);
  first.unmount();
  // liste vide
  engine((call) => (call.url === '/api/bots' ? json([]) : undefined));
  const empty = renderDialog();
  await screen.findByText(/Aucun agent IA/);
  expect(describedTargetExists()).toBe(true);
  empty.unmount();
  // échec de lecture
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  engine((call) => (call.url === '/api/bots' ? new Response('{}', { status: 500 }) : undefined));
  const failed = renderDialog();
  await screen.findByText(/Impossible de charger les agents IA/);
  expect(describedTargetExists()).toBe(true);
  failed.unmount();
  // choix à faire, puis agent IA en service qui garde son statut
  engine();
  renderDialog();
  await screen.findByRole('radio', { name: /SAV commandes/ });
  expect(describedTargetExists()).toBe(true);
  await userEvent.click(screen.getByRole('radio', { name: /Conseil Marais/ }));
  expect(describedTargetExists()).toBe(true);
});

// revue finale 2b-3 (contraste)
test('contraste : la raison de « Brancher » désactivé et la mention « perdra son numéro » sont en text-muted', async () => {
  engine();
  renderDialog();
  await screen.findByRole('radio', { name: /SAV commandes/ });
  expect(isReadableMuted(describedBy(screen.getByRole('button', { name: 'Brancher' })))).toBe(true);
  expect(isReadableMuted(screen.getByText(/perdra son numéro \+33 6 12 45 78 90/))).toBe(true);
});
