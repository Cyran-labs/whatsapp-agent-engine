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
  renderIntl(<AssignBotDialog account={accountView()} number={number} onClose={onClose} onDone={onDone} />);
  return { onClose, onDone };
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
  expect(calls.at(-1)).toEqual({ url: '/api/bots/sav/number', method: 'PUT', body: { number_id: 2 } });
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
