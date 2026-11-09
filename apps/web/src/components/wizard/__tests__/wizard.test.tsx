import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, test, expect } from 'vitest';
import { Wizard } from '../wizard';
import { accountView, numberView } from '@/components/connections/__tests__/fixtures';
import { json, renderIntl, stubFetch } from '@/components/connections/__tests__/helpers';

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/i18n/routing', () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

// Les étapes 1 à 4 ont leurs propres tests : ici elles ne servent qu'à atteindre l'étape 5.
vi.mock('../step-identity', () => ({
  StepIdentity: ({ onNext, update }: { onNext: () => void; update: (p: { name: string }) => void }) => (
    <button onClick={() => { update({ name: 'Ventes' }); onNext(); }}>identité</button>
  ),
}));
vi.mock('../step-personality', () => ({
  StepPersonality: ({ onCreated }: { onCreated: (id: string) => void }) => <button onClick={() => onCreated('ventes')}>personnalité</button>,
}));
vi.mock('../step-test', () => ({
  StepTest: ({ onNext }: { onNext: () => void }) => <button onClick={onNext}>test</button>,
}));
vi.mock('../step-number', () => ({
  StepNumber: ({ numberId, onChange, onNext }: { numberId: number | null; onChange: (id: number) => void; onNext: () => void }) => (
    <div>
      <span>numéro retenu : {String(numberId)}</span>
      <button onClick={() => onChange(1)}>choisir</button>
      <button onClick={onNext}>continuer</button>
    </div>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  nav.push.mockClear();
});

function stub() {
  return stubFetch((c) => {
    if (c.url === '/api/entities') return json([{ id: 4, name: 'Boutique Paris Marais', status: 'active', bots: 0, members: 1 }]);
    if (c.method === 'POST') return json({ bot_id: 'ventes', status: 'limited' });
    return json([accountView({ numbers: [numberView({ id: 1, phone_e164: '+33612457890' })] })]);
  });
}

async function reachStep5() {
  renderIntl(<Wizard initialEntityId={4} />);
  await userEvent.click(await screen.findByRole('button', { name: 'identité' }));
  await userEvent.click(screen.getByRole('button', { name: 'personnalité' }));
  await userEvent.click(screen.getByRole('button', { name: 'test' }));
  await userEvent.click(screen.getByRole('button', { name: 'choisir' }));
  await userEvent.click(screen.getByRole('button', { name: 'continuer' }));
  await screen.findByText('Compte WhatsApp connecté', { exact: false });
}

test('l\'étape 4 mène à l\'étape 5, qui connaît l\'entité et le numéro retenu', async () => {
  stub();
  await reachStep5();
  expect(screen.getByText('5 / 5')).toBeInTheDocument();
  expect(screen.getByText('Boutique Paris Marais')).toBeInTheDocument();
  expect(screen.getByText('+33 6 12 45 78 90')).toBeInTheDocument();
});

test('« Changer de numéro » revient à l\'étape 4 en gardant le numéro retenu', async () => {
  stub();
  await reachStep5();
  await userEvent.click(screen.getByRole('button', { name: /Changer de numéro/ }));
  expect(await screen.findByText('numéro retenu : 1')).toBeInTheDocument();
});

test('la liste d\'accès limité saisie survit à « Changer de numéro » puis au retour à l\'étape 5', async () => {
  stub();
  await reachStep5();
  await userEvent.type(screen.getByLabelText('Numéro à autoriser'), '+33612345678{Enter}');
  await userEvent.click(screen.getByRole('button', { name: /Changer de numéro/ }));
  await userEvent.click(await screen.findByRole('button', { name: 'continuer' }));
  await screen.findByText('Compte WhatsApp connecté', { exact: false });
  expect(screen.getByText('+33612345678')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Activer en accès limité' })).toBeEnabled();
});

test('« Laisser en brouillon » mène au succès en brouillon, avec « Brancher un numéro »', async () => {
  const calls = stub();
  await reachStep5();
  await userEvent.click(screen.getByRole('button', { name: 'Laisser en brouillon' }));
  expect(await screen.findByRole('link', { name: /Brancher un numéro/ })).toHaveAttribute('href', '/agents/ventes');
  expect(calls.some((c) => c.method === 'POST')).toBe(false);
});

test('activation réussie : écran de confirmation avec le numéro, le QR code et le lien wa.me', async () => {
  stub();
  await reachStep5();
  await userEvent.type(screen.getByLabelText('Numéro à autoriser'), '+33612345678{Enter}');
  await userEvent.click(screen.getByRole('button', { name: 'Activer en accès limité' }));
  expect(await screen.findByRole('heading', { name: 'Ventes est en ligne' })).toBeInTheDocument();
  expect(screen.getByText('Accès limité')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /wa\.me\/33612457890/ })).toHaveAttribute('href', 'https://wa.me/33612457890');
  const qr = await screen.findByRole('img', { name: /QR code/ });
  await waitFor(() => expect(qr.getAttribute('src')).toMatch(/^data:image\/png/));
  expect(screen.queryByText('5 / 5')).not.toBeInTheDocument();
});
