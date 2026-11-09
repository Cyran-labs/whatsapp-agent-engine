import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect, vi } from 'vitest';
import messages from '../../../../messages/fr.json';
import { SetupBanner } from '../setup-banner';

vi.mock('@/i18n/routing', () => ({
  Link: (p: { children: React.ReactNode; href: string; className?: string }) => <a href={p.href} className={p.className}>{p.children}</a>,
}));

const wrap = (hasActive: boolean, opts: { canConnect?: boolean; connected?: boolean } = {}) =>
  render(<NextIntlClientProvider locale="fr" messages={messages}>
    <SetupBanner
      checklist={{ created: true, personalized: true, connected: opts.connected ?? false, active: hasActive }}
      hasActive={hasActive}
      canConnect={opts.canConnect ?? true}
    />
  </NextIntlClientProvider>);

test('affichée tant qu aucun agent actif', () => { const { container } = wrap(false); expect(screen.getByText('Mise en route')).toBeInTheDocument(); expect(container.firstChild).not.toBeNull(); });
test('masquée quand un agent est actif', () => { const { container } = wrap(true); expect(container.firstChild).toBeNull(); });
test('admin : « Connecter WhatsApp » mène à Connexions', () => {
  wrap(false);
  expect(screen.getByRole('link', { name: 'Connecter WhatsApp' })).toHaveAttribute('href', '/organisation/connexions');
  expect(screen.queryByRole('button', { name: /Connecter WhatsApp/ })).not.toBeInTheDocument();
});
test('non admin : pas de lien vers Connexions (écran réservé aux administrateurs)', () => {
  wrap(false, { canConnect: false });
  expect(screen.queryByRole('link', { name: /Connecter WhatsApp/ })).not.toBeInTheDocument();
});
test('WhatsApp déjà connecté : plus de bouton « Connecter WhatsApp », l\'étape est cochée', () => {
  wrap(false, { connected: true });
  expect(screen.queryByRole('link', { name: 'Connecter WhatsApp' })).not.toBeInTheDocument();
  expect(screen.getByText('Connecter WhatsApp').previousElementSibling).toHaveTextContent('✓');
});
test('liseré gauche en encre menthe, pas en menthe', () => {
  const { container } = wrap(false);
  const classes = (container.firstChild as HTMLElement).className.split(/\s+/);
  expect(classes).toContain('border-l-accent-ink');
  expect(classes).not.toContain('border-l-accent');
});
