import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { AssignBotDialog } from '../assign-bot-dialog';
import { accountView, numberView } from './fixtures';
import { engineError, json, renderIntl, stubFetch, type Call } from './helpers';

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
  renderIntl(<AssignBotDialog account={accountView()} number={number} onClose={onClose} onDone={onDone} onStale={onStale} />);
  return { onClose, onDone, onStale };
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

test('numéro branché sur un agent IA en accès limité ou actif : l\'avertissement le nomme et dit qu\'il repasse en brouillon', async () => {
  engine();
  renderDialog(numberView({ id: 1, bot: { bot_id: 'conseil', name: 'Conseil Marais', status: 'limited' } }));
  await screen.findByRole('radio', { name: /SAV commandes/ });
  const warning = screen.getByRole('status');
  expect(warning).toHaveTextContent('Conseil Marais');
  expect(warning).toHaveTextContent(/repassera en brouillon/);
});

test('numéro branché sur un agent IA en brouillon : il le nomme sans parler de brouillon', async () => {
  engine();
  renderDialog(numberView({ id: 9, bot: { bot_id: 'vente', name: 'Vente en ligne', status: 'draft' } }));
  await screen.findByRole('radio', { name: /SAV commandes/ });
  const warning = screen.getByRole('status');
  expect(warning).toHaveTextContent('Vente en ligne');
  expect(warning).not.toHaveTextContent(/repassera en brouillon/);
});

test('l\'agent IA déjà branché sur ce numéro n\'est pas choisissable, avec sa raison', async () => {
  engine();
  renderDialog(numberView({ id: 1, bot: { bot_id: 'conseil', name: 'Conseil Marais', status: 'limited' } }));
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
    'Conseil Marais garde son statut « Accès limité » : il répondra tout de suite sur +33 1 84 80 12 34 aux numéros de sa liste d\'accès limité, et ne sera plus servi sur +33 6 12 45 78 90.',
  );
  expect(screen.getByRole('button', { name: 'Brancher' })).toHaveAccessibleDescription(/garde son statut/);
});

test('agent IA actif : le nouveau numéro sert tous les contacts', async () => {
  engine((call) => (call.url === '/api/bots'
    ? json([{ bot_id: 'actif', name: 'Boutique en ligne', status: 'active', whatsapp_number: { id: 7, phone_e164: '+33612457890' } }])
    : undefined));
  renderDialog();
  await userEvent.click(await screen.findByRole('radio', { name: /Boutique en ligne/ }));
  expect(screen.getByRole('status')).toHaveTextContent(/garde son statut « Actif » : il répondra tout de suite sur .* à tous les contacts/);
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
  const first = renderDialog(numberView({ id: 2, bot: { bot_id: 'vente', name: 'Vente en ligne', status: 'limited' } }));
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
