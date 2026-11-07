import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { vi, test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import { TopBar } from '../top-bar';

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
  usePathname: () => '/',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  routing: { locales: ['fr', 'en'], defaultLocale: 'fr' },
}));

function wrap(ui: React.ReactNode) {
  return render(<NextIntlClientProvider locale="fr" messages={messages}>{ui}</NextIntlClientProvider>);
}

test('variant root : logo + nav globale', () => {
  wrap(<TopBar variant="root" />);
  expect(screen.getByText('WABAGENT')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Agents IA' })).toBeInTheDocument();
  expect(screen.getByText('Usage & coûts')).toBeInTheDocument();
});

test('variant agent : fil d Ariane avec le nom', () => {
  wrap(<TopBar variant="agent" agentName="Support" />);
  expect(screen.getByText('Support')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Agents IA' })).toBeInTheDocument();
});
