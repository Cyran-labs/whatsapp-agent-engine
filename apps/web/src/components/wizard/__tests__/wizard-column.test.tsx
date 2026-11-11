import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { vi, test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import type { Session } from '@/components/providers/session-provider';
import type { OrganizationSummary } from '@/lib/organizations';
import { WizardColumn } from '../wizard-column';

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const ml: OrganizationSummary = { client_id: 'ml', name: 'Maison Lumière', role: 'admin', read_only: false };
const session: Session = {
  me: { id: 1, email: 'claire@x.fr', role: 'user', status: 'active', organizations: [ml] },
  activeOrg: ml,
  isPlatformAdmin: false,
  isAdmin: true,
  readOnly: false,
  switchOrg: vi.fn(),
  notice: null,
  dismissNotice: vi.fn(),
  refresh: vi.fn(),
};
vi.mock('@/components/providers/session-provider', () => ({ useSession: () => session }));

function wrap(props: Partial<React.ComponentProps<typeof WizardColumn>> = {}) {
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <WizardColumn step={1} furthest={1} created={false} activated={null} name="Conseiller showroom" onGo={vi.fn()} {...props} />
    </NextIntlClientProvider>,
  );
}

// prototype 6 : l'organisation est visible dans l'assistant
test('bloc Organisation, « ‹ Tous les agents IA » vers la liste, titre et stepper', () => {
  wrap();
  expect(screen.getByText('Maison Lumière')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Tous les agents IA/ })).toHaveAttribute('href', '/');
  expect(screen.getByText('Créer un agent IA')).toBeInTheDocument();
  expect(screen.getByRole('list', { name: "Étapes de l'assistant" })).toBeInTheDocument();
});

// prototype 6 : l'encadré d'état dit ce qui est enregistré, aux trois moments
test('avant la création : rien n\'est enregistré', () => {
  wrap();
  expect(screen.getByText("Rien n'est enregistré avant « Créer et tester » (étape 2).")).toBeInTheDocument();
  expect(screen.queryByText(/Draft enregistré/)).not.toBeInTheDocument();
});

test('après la création : Draft enregistré, avec le nom', () => {
  wrap({ step: 3, furthest: 3, created: true });
  expect(screen.getByText('Draft enregistré')).toBeInTheDocument();
  expect(
    screen.getByText("« Conseiller showroom » est dans la liste des agents IA, en Draft. Il ne répond à personne tant qu'il n'est pas activé. Vous pouvez quitter : vos réglages sont gardés."),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Rien n'est enregistré/)).not.toBeInTheDocument();
});

test.each([
  ['active', 'Conseiller showroom est Online'],
  ['limited', 'Conseiller showroom est en Preview'],
] as const)('après l\'activation (%s) : « %s »', (status, title) => {
  wrap({ step: 'success', furthest: 5, created: true, activated: { status, phone: '+33612457890' } });
  expect(screen.getByText(title)).toBeInTheDocument();
  expect(screen.queryByText('Draft enregistré')).not.toBeInTheDocument();
});

test('fin sans activation : l\'encadré reste « Draft enregistré »', () => {
  wrap({ step: 'success', furthest: 4, created: true, activated: null });
  expect(screen.getByText('Draft enregistré')).toBeInTheDocument();
});
