import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { vi, beforeEach, test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import { FirstRun } from '../first-run';

const session = vi.hoisted(() => ({ isAdmin: true, readOnly: false }));
vi.mock('@/components/providers/session-provider', () => ({ useSession: () => session }));
vi.mock('@/i18n/routing', () => ({
  Link: (p: { children: React.ReactNode; href: string }) => <a href={p.href}>{p.children}</a>,
}));

beforeEach(() => { session.isAdmin = true; session.readOnly = false; });

const wrap = () => render(<NextIntlClientProvider locale="fr" messages={messages}><FirstRun /></NextIntlClientProvider>);
const MESSAGE = "Aucun agent IA pour le moment. L'administrateur de votre organisation peut en créer un.";

test('admin : bouton de création, pas de message', () => {
  wrap();
  expect(screen.getByRole('link', { name: /Créer mon premier agent IA/ })).toHaveAttribute('href', '/agents/new');
  expect(screen.queryByText(MESSAGE)).not.toBeInTheDocument();
});

test('conseiller : message à la place du bouton', () => {
  session.isAdmin = false;
  wrap();
  expect(screen.getByText(MESSAGE)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Créer mon premier agent IA/ })).not.toBeInTheDocument();
});

test('admin en lecture seule : message à la place du bouton', () => {
  session.readOnly = true;
  wrap();
  expect(screen.getByText(MESSAGE)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Créer mon premier agent IA/ })).not.toBeInTheDocument();
});

// spec 5.4, 10.2 : Brancher et Activer existent, aucune étape n'est marquée « À venir »
test('admin : quatre étapes à faire, aucune « À venir », sans mention interne de plan', () => {
  wrap();
  expect(screen.getByText("Créer l'agent IA")).toBeInTheDocument();
  expect(screen.getByText('Brancher un numéro')).toBeInTheDocument();
  expect(screen.getByText("Activer l'agent IA")).toBeInTheDocument();
  expect(screen.queryByText('À venir')).not.toBeInTheDocument();
  expect(screen.getAllByText('À faire')).toHaveLength(4);
  expect(document.body.textContent).not.toMatch(/Plan \d|Verrouillé/);
});

test('conseiller : ni liste d\'étapes ni « À faire », titre et message gardés', () => {
  session.isAdmin = false;
  wrap();
  expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  expect(screen.queryByText("Créer l'agent IA")).not.toBeInTheDocument();
  expect(screen.queryByText('À faire')).not.toBeInTheDocument();
  expect(screen.queryByRole('list')).not.toBeInTheDocument();
  expect(screen.getByText(MESSAGE)).toBeInTheDocument();
});

test('admin en lecture seule : pas de liste d\'étapes', () => {
  session.readOnly = true;
  wrap();
  expect(screen.queryByRole('list')).not.toBeInTheDocument();
  expect(screen.queryByText('À faire')).not.toBeInTheDocument();
});
