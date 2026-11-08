import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import { SetupBanner } from '../setup-banner';

const wrap = (hasActive: boolean) =>
  render(<NextIntlClientProvider locale="fr" messages={messages}>
    <SetupBanner checklist={{ created: true, personalized: true, connected: false, active: hasActive }} hasActive={hasActive} />
  </NextIntlClientProvider>);

test('affichée tant qu aucun agent actif', () => { const { container } = wrap(false); expect(screen.getByText('Mise en route')).toBeInTheDocument(); expect(container.firstChild).not.toBeNull(); });
test('masquée quand un agent est actif', () => { const { container } = wrap(true); expect(container.firstChild).toBeNull(); });
test('CTA Connecter WhatsApp désactivé (7c)', () => { wrap(false); const btn = screen.getByRole('button', { name: /Connecter WhatsApp/ }); expect(btn).toBeDisabled(); });
test('liseré gauche en encre menthe, pas en menthe', () => {
  const { container } = wrap(false);
  const classes = (container.firstChild as HTMLElement).className.split(/\s+/);
  expect(classes).toContain('border-l-accent-ink');
  expect(classes).not.toContain('border-l-accent');
});
