import { act, fireEvent, render, screen, within } from '@testing-library/react';
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
// La mise en page monte aussi la garde de sortie de l'assistant, qui navigue par le routeur.
vi.mock('@/i18n/routing', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/' }));

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

const SUCCESS = 'Entité Nord archivée.';
const ERROR = "Changement d'organisation impossible.";

/** Ce que reçoit un lecteur d'écran : la seule région vivante de cette politesse dans le document. */
function live(level: 'polite' | 'assertive'): HTMLElement {
  const regions = document.querySelectorAll(`[aria-live="${level}"]`);
  expect(regions).toHaveLength(1);
  return regions[0] as HTMLElement;
}

/** Nombre de notifications dans la région. */
function count(level: 'polite' | 'assertive'): number {
  return live(level).children.length;
}

test('une région vivante par politesse, présentes avant toute notification, dans la zone Notifications', () => {
  render(tree(<PageA />));
  const zone = screen.getByRole('region', { name: 'Notifications' });
  expect(document.querySelectorAll('[aria-live]')).toHaveLength(2);
  expect(zone).toContainElement(live('polite'));
  expect(zone).toContainElement(live('assertive'));
  expect(zone).not.toHaveAttribute('aria-live');
  expect(count('polite')).toBe(0);
  expect(count('assertive')).toBe(0);
});

// Revue tâche 6 : aucune région vivante imbriquée, les notifications n'ont pas de rôle vivant propre.
test('aucun rôle vivant sur les notifications', () => {
  render(tree(<PageA />));
  click(`success ${SUCCESS}`);
  click(`error ${ERROR}`);
  const zone = screen.getByRole('region', { name: 'Notifications' });
  expect(zone.querySelectorAll('[role="status"], [role="alert"], [role="log"], [aria-live] [aria-live]')).toHaveLength(0);
  expect(document.querySelectorAll('[aria-live]')).toHaveLength(2);
});

test('réussite : lue dans la région polie, retirée après 5 s', () => {
  render(tree(<PageA />));
  click(`success ${SUCCESS}`);
  expect(live('polite')).toHaveTextContent(SUCCESS);
  expect(live('assertive')).toBeEmptyDOMElement();
  act(() => {
    vi.advanceTimersByTime(4999);
  });
  expect(live('polite')).toHaveTextContent(SUCCESS);
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(live('polite')).toBeEmptyDOMElement();
});

test('erreur : lue dans la région assertive, persistante jusqu\'à fermeture', () => {
  render(tree(<PageA />));
  click(`error ${ERROR}`);
  expect(live('assertive')).toHaveTextContent(ERROR);
  expect(live('polite')).toBeEmptyDOMElement();
  act(() => {
    vi.advanceTimersByTime(60_000);
  });
  expect(live('assertive')).toHaveTextContent(ERROR);
  fireEvent.click(within(live('assertive')).getByRole('button', { name: 'Fermer la notification' }));
  expect(live('assertive')).toBeEmptyDOMElement();
});

test('réussite fermée avant 5 s : retirée, rien ne se passe à l\'échéance', () => {
  render(tree(<PageA />));
  click(`success ${SUCCESS}`);
  fireEvent.click(within(live('polite')).getByRole('button', { name: 'Fermer la notification' }));
  expect(live('polite')).toBeEmptyDOMElement();
  act(() => {
    vi.advanceTimersByTime(5000);
  });
  expect(live('polite')).toBeEmptyDOMElement();
});

test('plusieurs notifications : chacune garde son délai', () => {
  render(tree(<PageA />));
  click(`success ${SUCCESS}`);
  act(() => {
    vi.advanceTimersByTime(3000);
  });
  click(`error ${ERROR}`);
  click(`success ${SUCCESS}`);
  expect(count('polite')).toBe(2);
  act(() => {
    vi.advanceTimersByTime(2000);
  });
  expect(count('polite')).toBe(1);
  act(() => {
    vi.advanceTimersByTime(3000);
  });
  expect(count('polite')).toBe(0);
  expect(live('assertive')).toHaveTextContent(ERROR);
});

// Point d'attention 5 : le fournisseur est au-dessus des pages ; la réussite reste lisible sur la page d'arrivée
// pendant ses 5 s.
test('réussite qui survit à une navigation côté client', () => {
  const { rerender } = render(tree(<PageA />));
  click(`success ${SUCCESS}`);
  act(() => {
    vi.advanceTimersByTime(2000);
  });
  rerender(tree(<PageB />));
  expect(screen.getByRole('heading', { name: 'Utilisateurs' })).toBeInTheDocument();
  expect(live('polite')).toHaveTextContent(SUCCESS);
  act(() => {
    vi.advanceTimersByTime(3000);
  });
  expect(live('polite')).toBeEmptyDOMElement();
});

// Point d'attention 5 : une erreur persistante ne survit pas au changement d'organisation affichée (elle parlait de
// l'organisation précédente).
test('erreur effacée au changement d\'organisation, gardée sinon', () => {
  const { rerender } = render(tree(<PageA />));
  click(`error ${ERROR}`);
  rerender(tree(<PageB />));
  expect(live('assertive')).toHaveTextContent(ERROR);
  session.clientId = 'org-b';
  rerender(tree(<PageB />));
  expect(live('assertive')).toBeEmptyDOMElement();
});

test('erreur effacée pour de bon : retour à l\'organisation précédente sans la revoir', () => {
  const { rerender } = render(tree(<PageA />));
  click(`error ${ERROR}`);
  session.clientId = 'org-b';
  rerender(tree(<PageA />));
  session.clientId = 'org-a';
  rerender(tree(<PageA />));
  expect(live('assertive')).toBeEmptyDOMElement();
});

test('réussite effacée aussi au changement d\'organisation (elle nommait un objet de la précédente)', () => {
  const { rerender } = render(tree(<PageA />));
  click(`success ${SUCCESS}`);
  session.clientId = 'org-b';
  rerender(tree(<PageA />));
  expect(live('polite')).toBeEmptyDOMElement();
});

test('erreur effacée quand plus aucune organisation n\'est affichée', () => {
  const { rerender } = render(tree(<PageA />));
  click(`error ${ERROR}`);
  session.clientId = null;
  rerender(tree(<PageA />));
  expect(live('assertive')).toBeEmptyDOMElement();
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
  click(`success ${SUCCESS}`);
  expect(live('polite')).toHaveTextContent(SUCCESS);
});
