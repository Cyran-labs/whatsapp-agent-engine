import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect, vi } from 'vitest';
import messages from '../../../../messages/fr.json';
import { SetupBanner } from '../setup-banner';

vi.mock('@/i18n/routing', () => ({
  Link: (p: { children: React.ReactNode; href: string; className?: string }) => <a href={p.href} className={p.className}>{p.children}</a>,
}));

const wrap = (hasActive: boolean, opts: { canConnect?: boolean; connected?: boolean; connectHref?: string } = {}) =>
  render(<NextIntlClientProvider locale="fr" messages={messages}>
    <SetupBanner
      checklist={{ created: true, personalized: true, connected: opts.connected ?? false, active: hasActive }}
      hasActive={hasActive}
      canConnect={opts.canConnect ?? true}
      connectHref={opts.connectHref ?? '/organisation/connexions'}
    />
  </NextIntlClientProvider>);

test('affichée tant qu aucun agent actif', () => { const { container } = wrap(false); expect(screen.getByText('Mise en route')).toBeInTheDocument(); expect(container.firstChild).not.toBeNull(); });
test('masquée quand un agent est actif', () => { const { container } = wrap(true); expect(container.firstChild).toBeNull(); });
// prototype 8 : la destination vient de la page (connectTarget), le bandeau ne la choisit pas
test('admin : « Brancher un numéro » mène à la destination reçue', () => {
  wrap(false, { connectHref: '/agents/demo-3' });
  expect(screen.getByRole('link', { name: 'Brancher un numéro' })).toHaveAttribute('href', '/agents/demo-3');
  expect(screen.queryByRole('button', { name: /Brancher un numéro/ })).not.toBeInTheDocument();
});
test('non admin : pas de lien vers Connexions (écran réservé aux administrateurs)', () => {
  wrap(false, { canConnect: false });
  expect(screen.queryByRole('link', { name: /Brancher un numéro/ })).not.toBeInTheDocument();
});
test('WhatsApp déjà connecté : plus de bouton « Brancher un numéro », l\'étape est cochée', () => {
  wrap(false, { connected: true });
  expect(screen.queryByRole('link', { name: 'Brancher un numéro' })).not.toBeInTheDocument();
  expect(screen.getByText('Brancher un numéro').previousElementSibling).toHaveTextContent('✓');
});
test('liseré gauche en encre menthe, pas en menthe', () => {
  const { container } = wrap(false);
  const classes = (container.firstChild as HTMLElement).className.split(/\s+/);
  expect(classes).toContain('border-l-accent-ink');
  expect(classes).not.toContain('border-l-accent');
});
