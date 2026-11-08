import { render, screen, waitFor } from '@testing-library/react';
import { vi, beforeEach, test, expect } from 'vitest';
import NewAgentPage from '../page';

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));
vi.mock('@/i18n/routing', () => ({ useRouter: () => ({ replace: nav.replace, push: vi.fn() }) }));
vi.mock('@/components/shell/top-bar', () => ({ TopBar: () => <div data-testid="top-bar" /> }));
vi.mock('@/components/wizard/wizard', () => ({ Wizard: () => <div data-testid="wizard" /> }));

const session = vi.hoisted(() => ({ isAdmin: true, readOnly: false }));
vi.mock('@/components/providers/session-provider', () => ({
  useSession: () => ({ isAdmin: session.isAdmin, readOnly: session.readOnly }),
}));

beforeEach(() => {
  nav.replace.mockClear();
  session.isAdmin = true;
  session.readOnly = false;
});

test('admin : assistant de création affiché, pas de redirection', () => {
  render(<NewAgentPage />);
  expect(screen.getByTestId('wizard')).toBeInTheDocument();
  expect(nav.replace).not.toHaveBeenCalled();
});

test('non-admin : redirigé vers l\'accueil, assistant non rendu', async () => {
  session.isAdmin = false;
  render(<NewAgentPage />);
  await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/'));
  expect(screen.queryByTestId('wizard')).not.toBeInTheDocument();
});

test('lecture seule : redirigé vers l\'accueil, assistant non rendu', async () => {
  session.readOnly = true;
  render(<NewAgentPage />);
  await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/'));
  expect(screen.queryByTestId('wizard')).not.toBeInTheDocument();
});
