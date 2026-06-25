import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, test, expect } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import { Wizard } from '../wizard';

vi.mock('@/i18n/routing', () => ({ useRouter: () => ({ push: vi.fn() }), Link: (p: { children: React.ReactNode }) => p.children }));
beforeEach(() => vi.restoreAllMocks());

function renderWizard() {
  return render(<NextIntlClientProvider locale="fr" messages={messages}><Wizard /></NextIntlClientProvider>);
}

test('le nom genere le slug automatiquement', async () => {
  renderWizard();
  await userEvent.type(screen.getByLabelText('Nom de l\'agent'), 'Assistant Boutique');
  expect(screen.getByText(/assistant-boutique/)).toBeInTheDocument();
});

test('Continuer passe a l\'etape Personnalite', async () => {
  renderWizard();
  await userEvent.type(screen.getByLabelText('Nom de l\'agent'), 'Ventes');
  await userEvent.click(screen.getByRole('button', { name: /Continuer/ }));
  expect(screen.getByText('La personnalité de votre agent')).toBeInTheDocument();
});
