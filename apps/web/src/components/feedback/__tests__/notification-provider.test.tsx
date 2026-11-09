import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import fr from '../../../../messages/fr.json';
import AppLayout from '@/app/[locale]/(app)/layout';
import { NotificationProvider, useNotify } from '../notification-provider';

// Organisation affichée lue dans la session : le test la change entre deux rendus.
const session = vi.hoisted(() => ({ clientId: 'org-a' as string | null }));
vi.mock('@/components/providers/session-provider', () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
  useSession: () => ({ activeOrg: session.clientId === null ? null : { client_id: session.clientId }, notice: null }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  session.clientId = 'org-a';
});
afterEach(() => {
  vi.useRealTimers();
});

function Trigger({ kind, text }: { kind: 'success' | 'error'; text: string }) {
  const notify = useNotify();
  return (
    <button type="button" onClick={() => notify[kind](text)}>
      {`${kind} ${text}`}
    </button>
  );
}

function PageA() {
  return (
    <main>
      <h1>Entités</h1>
      <Trigger kind="success" text="Entité Nord archivée." />
      <Trigger kind="error" text="Changement d'organisation impossible." />
    </main>
  );
}

function PageB() {
  return (
    <main>
      <h1>Utilisateurs</h1>
    </main>
  );
}

function tree(page: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="fr" messages={fr}>
      <NotificationProvider>{page}</NotificationProvider>
    </NextIntlClientProvider>
  );
}

function click(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
}

test('une seule région aria-live, présente avant toute notification', () => {
  const { container } = render(tree(<PageA />));
  const regions = container.querySelectorAll('[aria-live]');
  expect(regions).toHaveLength(1);
  expect(regions[0]).toHaveAttribute('aria-live', 'polite');
  expect(screen.getByRole('region', { name: 'Notifications' })).toBe(regions[0]);
});

test('réussite : lue par role="status", retirée après 5 s', () => {
  render(tree(<PageA />));
  click('success Entité Nord archivée.');
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('Entité Nord archivée.');
  expect(screen.getByRole('region', { name: 'Notifications' })).toContainElement(status);
  act(() => {
    vi.advanceTimersByTime(4999);
  });
  expect(screen.getByRole('status')).toBeInTheDocument();
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('erreur : role="alert", persistante jusqu\'à fermeture', () => {
  render(tree(<PageA />));
  click("error Changement d'organisation impossible.");
  expect(screen.getByRole('alert')).toHaveTextContent("Changement d'organisation impossible.");
  act(() => {
    vi.advanceTimersByTime(60_000);
  });
  expect(screen.getByRole('alert')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Fermer la notification' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('réussite fermée avant 5 s : retirée, rien ne se passe à l\'échéance', () => {
  render(tree(<PageA />));
  click('success Entité Nord archivée.');
  fireEvent.click(screen.getByRole('button', { name: 'Fermer la notification' }));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  act(() => {
    vi.advanceTimersByTime(5000);
  });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('plusieurs notifications : chacune garde son délai', () => {
  render(tree(<PageA />));
  click('success Entité Nord archivée.');
  act(() => {
    vi.advanceTimersByTime(3000);
  });
  click("error Changement d'organisation impossible.");
  click('success Entité Nord archivée.');
  expect(screen.getAllByRole('status')).toHaveLength(2);
  act(() => {
    vi.advanceTimersByTime(2000);
  });
  expect(screen.getAllByRole('status')).toHaveLength(1);
  act(() => {
    vi.advanceTimersByTime(3000);
  });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toBeInTheDocument();
});

// Point d'attention 5 : le fournisseur est au-dessus des pages ; la réussite reste lisible sur la page d'arrivée
// pendant ses 5 s.
test('réussite qui survit à une navigation côté client', () => {
  const { rerender } = render(tree(<PageA />));
  click('success Entité Nord archivée.');
  act(() => {
    vi.advanceTimersByTime(2000);
  });
  rerender(tree(<PageB />));
  expect(screen.getByRole('heading', { name: 'Utilisateurs' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Entité Nord archivée.');
  act(() => {
    vi.advanceTimersByTime(3000);
  });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

// Point d'attention 5 : une erreur persistante ne survit pas au changement d'organisation affichée (elle parlait de
// l'organisation précédente).
test('erreur effacée au changement d\'organisation, gardée sinon', () => {
  const { rerender } = render(tree(<PageA />));
  click("error Changement d'organisation impossible.");
  rerender(tree(<PageB />));
  expect(screen.getByRole('alert')).toBeInTheDocument();
  session.clientId = 'org-b';
  rerender(tree(<PageB />));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('erreur effacée pour de bon : retour à l\'organisation précédente sans la revoir', () => {
  const { rerender } = render(tree(<PageA />));
  click("error Changement d'organisation impossible.");
  session.clientId = 'org-b';
  rerender(tree(<PageA />));
  session.clientId = 'org-a';
  rerender(tree(<PageA />));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('réussite effacée aussi au changement d\'organisation (elle nommait un objet de la précédente)', () => {
  const { rerender } = render(tree(<PageA />));
  click('success Entité Nord archivée.');
  session.clientId = 'org-b';
  rerender(tree(<PageA />));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('erreur effacée quand plus aucune organisation n\'est affichée', () => {
  const { rerender } = render(tree(<PageA />));
  click("error Changement d'organisation impossible.");
  session.clientId = null;
  rerender(tree(<PageA />));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('useNotify hors du fournisseur : erreur explicite', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  expect(() => render(<NextIntlClientProvider locale="fr" messages={fr}><Trigger kind="success" text="x" /></NextIntlClientProvider>)).toThrow(
    /NotificationProvider/,
  );
  spy.mockRestore();
});

test('le fournisseur est monté par la mise en page de l\'application, au-dessus des pages', () => {
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <AppLayout>
        <PageA />
      </AppLayout>
    </NextIntlClientProvider>,
  );
  expect(screen.getAllByRole('region', { name: 'Notifications' })).toHaveLength(1);
  click('success Entité Nord archivée.');
  expect(screen.getByRole('status')).toHaveTextContent('Entité Nord archivée.');
});
