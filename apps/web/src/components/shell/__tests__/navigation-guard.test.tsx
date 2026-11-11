import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { useEffect } from 'react';
import { vi, beforeEach, test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import { GuardedLink, NavigationGuardProvider, useNavigationGuard } from '../navigation-guard';

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
}));

beforeEach(() => nav.push.mockClear());

/** Pose la garde selon `active` et expose `confirmLeave` par un bouton dont le texte dit la réponse. */
function Probe({ active }: { active: boolean }) {
  const { setGuard, confirmLeave } = useNavigationGuard();
  useEffect(() => {
    setGuard(active);
    return () => setGuard(false);
  }, [active, setGuard]);
  return (
    <button
      type="button"
      onClick={(e) => {
        const target = e.currentTarget;
        void confirmLeave().then((ok) => { target.dataset.answer = String(ok); });
      }}
    >
      sortir
    </button>
  );
}

function wrap(ui: React.ReactNode, withProvider = true) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      {withProvider ? <NavigationGuardProvider>{ui}</NavigationGuardProvider> : ui}
    </NextIntlClientProvider>,
  );
}

// amendement A-8 : sans fournisseur, rail, colonne et bloc Organisation se rendent et naviguent sans fenêtre.
test('sans fournisseur : confirmLeave rend true, aucune fenêtre', async () => {
  wrap(<Probe active />, false);
  const button = screen.getByRole('button', { name: 'sortir' });
  await userEvent.click(button);
  await waitFor(() => expect(button.dataset.answer).toBe('true'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('aucune garde posée : confirmLeave rend true sans fenêtre', async () => {
  wrap(<Probe active={false} />);
  const button = screen.getByRole('button', { name: 'sortir' });
  await userEvent.click(button);
  await waitFor(() => expect(button.dataset.answer).toBe('true'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('garde posée : fenêtre « Quitter la création ? » ; « Rester » rend false et la ferme', async () => {
  wrap(<Probe active />);
  const button = screen.getByRole('button', { name: 'sortir' });
  await userEvent.click(button);
  const dialog = await screen.findByRole('dialog', { name: 'Quitter la création ?' });
  expect(dialog).toHaveTextContent("Ce que vous avez saisi n'est pas encore enregistré.");
  await userEvent.click(screen.getByRole('button', { name: 'Rester' }));
  await waitFor(() => expect(button.dataset.answer).toBe('false'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('garde posée : « Quitter sans enregistrer » rend true', async () => {
  wrap(<Probe active />);
  const button = screen.getByRole('button', { name: 'sortir' });
  await userEvent.click(button);
  await userEvent.click(await screen.findByRole('button', { name: 'Quitter sans enregistrer' }));
  await waitFor(() => expect(button.dataset.answer).toBe('true'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('Échap vaut « Rester »', async () => {
  wrap(<Probe active />);
  const button = screen.getByRole('button', { name: 'sortir' });
  await userEvent.click(button);
  await screen.findByRole('dialog');
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(button.dataset.answer).toBe('false'));
});

test('fermeture de l\'onglet : beforeunload retenu tant que la garde est posée, plus après', () => {
  const { rerender } = wrap(<Probe active />);
  const held = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(held);
  expect(held.defaultPrevented).toBe(true);

  rerender(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <NavigationGuardProvider><Probe active={false} /></NavigationGuardProvider>
    </NextIntlClientProvider>,
  );
  const free = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(free);
  expect(free.defaultPrevented).toBe(false);
});

/** Lève la garde puis simule le rechargement dans le même tour, comme la session avant `location.assign`. */
function Releaser() {
  const { setGuard } = useNavigationGuard();
  return (
    <button
      type="button"
      onClick={(e) => {
        setGuard(false);
        const unload = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(unload);
        e.currentTarget.dataset.prevented = String(unload.defaultPrevented);
      }}
    >
      lever
    </button>
  );
}

test('setGuard(false) vaut tout de suite : un rechargement lancé dans le même tour n\'est pas retenu', async () => {
  wrap(<><Probe active /><Releaser /></>);
  const button = screen.getByRole('button', { name: 'lever' });
  await userEvent.click(button);
  expect(button.dataset.prevented).toBe('false');
});

test('lien gardé sans garde : navigation ordinaire du lien, aucune fenêtre', async () => {
  wrap(<GuardedLink href="/usage">Usage</GuardedLink>);
  const link = screen.getByRole('link', { name: 'Usage' });
  // Relevé après le gestionnaire du lien, puis navigation de jsdom évitée (non prise en charge).
  let preventedByLink: boolean | null = null;
  const observe = (e: Event) => { preventedByLink = e.defaultPrevented; e.preventDefault(); };
  window.addEventListener('click', observe);
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  window.removeEventListener('click', observe);
  expect(preventedByLink).toBe(false);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('lien gardé, garde posée : fenêtre ; « Rester » ne navigue pas, « Quitter sans enregistrer » navigue vers le lien', async () => {
  wrap(<><Probe active /><GuardedLink href="/usage">Usage</GuardedLink></>);
  await userEvent.click(screen.getByRole('link', { name: 'Usage' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Rester' }));
  expect(nav.push).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole('link', { name: 'Usage' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Quitter sans enregistrer' }));
  await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/usage'));
});
