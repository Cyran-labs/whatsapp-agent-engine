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
