import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, test, expect } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../../messages/fr.json';
import enMessages from '../../../../../messages/en.json';
import LoginPage from '../page';

const push = vi.fn();
vi.mock('@/i18n/routing', () => ({
  useRouter: () => ({ push }),
  Link: (p: { children: React.ReactNode; href: string }) => <a href={p.href}>{p.children}</a>,
  routing: { locales: ['fr', 'en'], defaultLocale: 'fr' },
}));
vi.mock('next-intl/server', async () => {
  const fr = (await import('../../../../../messages/fr.json')).default as { auth: Record<string, unknown> };
  return {
    getTranslations: async () => (key: string) => {
      const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], fr.auth);
      return value as string;
    },
  };
});

beforeEach(() => {
  push.mockReset();
  vi.restoreAllMocks();
});

const BANNER = "Votre session a expiré. Reconnectez-vous pour reprendre là où vous étiez. Ce qui n'était pas enregistré est perdu.";

async function renderPage(searchParams: Record<string, string | string[] | undefined>, locale: 'fr' | 'en' = 'fr') {
  const ui = await LoginPage({ searchParams: Promise.resolve(searchParams) });
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'fr' ? messages : enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

async function signIn() {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ user: { id: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } })));
  await userEvent.type(screen.getByLabelText('Adresse e-mail'), 'demo@example.com');
  await userEvent.type(screen.getByLabelText('Mot de passe'), 'motdepasse12');
  await userEvent.click(screen.getByRole('button', { name: 'Se connecter' }));
}

// audit R-10
test('reason=session : bandeau d\'explication de la session expirée', async () => {
  await renderPage({ reason: 'session' });
  expect(screen.getByRole('status')).toHaveTextContent(BANNER);
});

test('sans motif : pas de bandeau', async () => {
  await renderPage({});
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('motif inconnu : pas de bandeau', async () => {
  await renderPage({ reason: 'autre' });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

// audit R-10
test('next valide : la connexion réussie y renvoie, requête comprise, sans doubler la langue', async () => {
  await renderPage({ reason: 'session', next: '/fr/organisation/membres?tab=invitations' });
  await signIn();
  expect(push).toHaveBeenCalledWith('/organisation/membres?tab=invitations', { locale: 'fr' });
});

// audit R-10 : point d'attention 1
test.each(['https://evil.example/fr', '//evil.example', '/\\evil.example', '/api/auth/logout', 'javascript:alert(1)'])(
  'next hostile %s : la connexion réussie mène à l\'accueil',
  async (next) => {
    await renderPage({ reason: 'session', next });
    await signIn();
    expect(push).toHaveBeenCalledWith('/');
  },
);

test('next répété (tableau) : ignoré, accueil', async () => {
  await renderPage({ next: ['/fr/a', '/fr/b'] });
  await signIn();
  expect(push).toHaveBeenCalledWith('/');
});

test('sans next : accueil', async () => {
  await renderPage({});
  await signIn();
  expect(push).toHaveBeenCalledWith('/');
});
