import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import type { WhatsAppAccountCreated } from '@wabagent/contracts';
import messages from '../../../../../../../../messages/fr.json';
import { accountView } from '@/components/connections/__tests__/fixtures';
import { engineError, json, stubFetch } from '@/components/connections/__tests__/helpers';
import { OrganisationCountsContext } from '@/components/organisation/organisation-counts';
import RaccorderPage from '../page';

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

const refreshCounts = vi.fn();

beforeEach(() => {
  vi.restoreAllMocks();
  refreshCounts.mockReset();
});

const created: WhatsAppAccountCreated = {
  ...accountView({ id: 7, name: 'Boutique principale' }),
  checks: [{ key: 'token', status: 'ok' }],
  inventory: { added: 1, removed: 0, refused: 0, skipped_sandbox: 0, skipped_invalid: 0 },
};

async function renderPage() {
  await act(async () => {
    render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <OrganisationCountsContext.Provider value={{ refreshCounts }}>
          <RaccorderPage />
        </OrganisationCountsContext.Provider>
      </NextIntlClientProvider>,
    );
  });
}

async function fillAndSubmit() {
  await userEvent.type(screen.getByLabelText('Nom du compte dans WABAGENT'), 'Boutique principale');
  await userEvent.type(screen.getByLabelText('ID du compte WhatsApp Business (WABA)'), '104829371625544');
  await userEvent.type(screen.getByLabelText("Jeton d'accès"), 'EAAG-jeton-long-1234567890');
  await userEvent.type(screen.getByLabelText("Secret de l'app"), 'a1b2c3d4e5f6a7b8c9d0');
  await userEvent.click(screen.getByRole('button', { name: 'Vérifier et raccorder' }));
}

test('après le raccordement, le formulaire laisse la place au résultat et le compteur du rail se relit', async () => {
  stubFetch(() => json(created, 201));
  await renderPage();
  expect(screen.getByRole('heading', { level: 1, name: 'Raccorder un compte WhatsApp' })).toBeInTheDocument();
  await fillAndSubmit();
  expect(await screen.findByRole('heading', { name: 'Compte raccordé' })).toBeInTheDocument();
  expect(screen.queryByLabelText("Jeton d'accès")).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Terminer' })).toHaveAttribute('href', '/organisation/connexions');
  expect(refreshCounts).toHaveBeenCalledTimes(1);
});

test('refus du moteur : le formulaire reste, pas de résultat, compteur intact', async () => {
  stubFetch(() => engineError(409, 'CONFLICT', 'Ce compte WhatsApp ne peut pas être raccordé.'));
  await renderPage();
  await fillAndSubmit();
  expect(await screen.findByRole('alert')).toHaveTextContent('Ce compte WhatsApp ne peut pas être raccordé.');
  expect(screen.queryByRole('heading', { name: 'Compte raccordé' })).not.toBeInTheDocument();
  expect(refreshCounts).not.toHaveBeenCalled();
});

// Point d'attention 2 : organisation changée dans un autre onglet.
test('409 ORG_CHANGED : ni résultat ni message', async () => {
  stubFetch(() => engineError(409, 'ORG_CHANGED', "L'organisation a changé."));
  await renderPage();
  await fillAndSubmit();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Vérifier et raccorder' })).toBeEnabled());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Compte raccordé' })).not.toBeInTheDocument();
});
