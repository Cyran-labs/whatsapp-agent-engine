import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { vi, test, expect } from 'vitest';
import fr from '../../../../messages/fr.json';
import en from '../../../../messages/en.json';
import { Success } from '../success';
import type { WizardState } from '@/lib/bot-draft';

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const state: WizardState = {
  name: 'Ventes', slug: 'ventes', languages: ['fr'], defaultLanguage: 'fr',
  perLang: { fr: { mode: 'guided', role: 'Conseiller', tones: [], objective: '', info: '', raw: '' } },
  welcomeEnabled: true, welcome: { fr: 'Bonjour' }, leadFields: [], entityId: null,
};

function renderSuccess(over: Partial<React.ComponentProps<typeof Success>> = {}, locale: 'fr' | 'en' = 'fr') {
  const props = { state, botId: 'ventes', onHome: vi.fn(), onEdit: vi.fn(), activated: null, ...over };
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'fr' ? fr : en}>
      <Success {...props} />
    </NextIntlClientProvider>,
  );
  return props;
}

test.each([
  ['fr', 'Brancher un numéro'],
  ['en', 'Assign a number'],
] as const)('%s : en brouillon, « Brancher un numéro » mène à la page de l\'agent IA, sans « à venir » ni mention de plan', (locale, label) => {
  renderSuccess({}, locale);
  const link = screen.getByRole('link', { name: new RegExp(label) });
  expect(link).toHaveAttribute('href', '/agents/ventes');
  expect(screen.queryByText(/À venir|Coming soon/)).not.toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/Plan \d/);
});

test('en brouillon : récapitulatif, statut Brouillon, retour et modification de la personnalité', async () => {
  const props = renderSuccess();
  expect(screen.getByText('Brouillon')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Retour aux agents IA' }));
  expect(props.onHome).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Modifier la personnalité' }));
  expect(props.onEdit).toHaveBeenCalledTimes(1);
});

test('actif : confirmation « est en ligne », pastille Ouvert à tous, numéro, QR code et lien wa.me', async () => {
  renderSuccess({ activated: { status: 'active', phone: '+33612457890' } });
  expect(screen.getByRole('heading', { name: 'Ventes est en ligne' })).toBeInTheDocument();
  expect(screen.getByText('Ouvert à tous')).toBeInTheDocument();
  expect(screen.getByText('+33 6 12 45 78 90')).toBeInTheDocument();
  const qr = await screen.findByRole('img', { name: /QR code/ });
  await waitFor(() => expect(qr.getAttribute('src')).toMatch(/^data:image\/png/));
  const link = screen.getByRole('link', { name: /wa\.me\/33612457890/ });
  expect(link).toHaveAttribute('href', 'https://wa.me/33612457890');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  expect(screen.queryByText(/Brouillon/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Brancher un numéro/)).not.toBeInTheDocument();
});

test('accès limité : pastille « Accès limité » et rappel que seuls les numéros de la liste reçoivent une réponse', () => {
  renderSuccess({ activated: { status: 'limited', phone: '+33612457890' } });
  expect(screen.getByText('Accès limité')).toBeInTheDocument();
  expect(screen.getByText(/seuls les numéros de la liste d'accès limité reçoivent une réponse/)).toBeInTheDocument();
});

test('QR code en cours de génération : un espace réservé de même taille évite le saut de mise en page', async () => {
  const qrcode = await import('qrcode');
  let finish: (src: string) => void = () => {};
  vi.spyOn(qrcode.default, 'toDataURL').mockImplementation((() => new Promise<string>((resolve) => { finish = resolve; })) as unknown as typeof qrcode.default.toDataURL);
  renderSuccess({ activated: { status: 'active', phone: '+33612457890' } });
  const placeholder = document.querySelector('[data-skeleton]');
  expect(placeholder).toHaveClass('h-[112px]', 'w-[112px]');
  expect(screen.queryByRole('img', { name: /QR code/ })).not.toBeInTheDocument();
  await act(async () => { finish('data:image/png;base64,AAAA'); });
  const qr = await screen.findByRole('img', { name: /QR code/ });
  expect(qr).toHaveClass('h-[112px]', 'w-[112px]');
  expect(document.querySelector('[data-skeleton]')).toBeNull();
});

test('actif : pas de rappel d\'accès limité', () => {
  renderSuccess({ activated: { status: 'active', phone: '+33612457890' } });
  expect(screen.queryByText(/seuls les numéros de la liste/)).not.toBeInTheDocument();
});

test('« Retour aux agents IA » et « Ouvrir l\'agent IA » (lien vers la page de l\'agent IA) en confirmation', async () => {
  const props = renderSuccess({ activated: { status: 'limited', phone: '+33612457890' } });
  await userEvent.click(screen.getByRole('button', { name: 'Retour aux agents IA' }));
  expect(props.onHome).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('link', { name: 'Ouvrir l\'agent IA' })).toHaveAttribute('href', '/agents/ventes');
});

test('en : confirmation en anglais', async () => {
  renderSuccess({ activated: { status: 'limited', phone: '+33612457890' } }, 'en');
  expect(screen.getByRole('heading', { name: 'Ventes is live' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open the AI agent' })).toBeInTheDocument();
});

test('QR code impossible à générer : le lien wa.me reste affiché', async () => {
  const qrcode = await import('qrcode');
  vi.spyOn(qrcode.default, 'toDataURL').mockRejectedValue(new Error('boom'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  renderSuccess({ activated: { status: 'active', phone: '+33612457890' } });
  expect(screen.getByRole('link', { name: /wa\.me\/33612457890/ })).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('img', { name: /QR code/ })).not.toBeInTheDocument());
});

// revue 2b-3 M-3
test('numéro illisible dans la réponse du moteur : confirmation sans QR code ni lien wa.me, statut et accès à la page de l\'agent IA gardés', async () => {
  const qrcode = await import('qrcode');
  const toDataURL = vi.spyOn(qrcode.default, 'toDataURL');
  toDataURL.mockClear();
  renderSuccess({ activated: { status: 'limited', phone: null } });
  expect(screen.getByRole('heading', { name: 'Ventes est en ligne' })).toBeInTheDocument();
  expect(screen.getByText('Accès limité')).toBeInTheDocument();
  expect(screen.getByText(/Le numéro n'a pas pu être relu/)).toBeInTheDocument();
  expect(screen.queryByRole('img', { name: /QR code/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /wa\.me/ })).not.toBeInTheDocument();
  expect(document.querySelector('[data-skeleton]')).toBeNull();
  expect(toDataURL).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: 'Ouvrir l\'agent IA' })).toHaveAttribute('href', '/agents/ventes');
});

// revue finale 2b-3 m-8
test('identifiant d\'agent IA à caractères spéciaux : encodé dans les liens vers sa page (brouillon et actif)', () => {
  renderSuccess({ botId: 'a b/c' });
  for (const link of screen.getAllByRole('link')) {
    const href = link.getAttribute('href') ?? '';
    if (href.startsWith('/agents/')) expect(href).toBe('/agents/a%20b%2Fc');
  }
  expect(screen.getAllByRole('link').some((l) => l.getAttribute('href') === '/agents/a%20b%2Fc')).toBe(true);
});

test('actif : le lien « Ouvrir l\'agent IA » encode l\'identifiant', () => {
  renderSuccess({ botId: 'a b/c', activated: { status: 'limited', phone: '+33612457890' } });
  expect(screen.getByRole('link', { name: /Ouvrir/ })).toHaveAttribute('href', '/agents/a%20b%2Fc');
});
