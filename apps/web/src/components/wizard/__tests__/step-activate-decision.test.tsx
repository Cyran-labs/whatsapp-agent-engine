import { screen } from '@testing-library/react';
import { vi, beforeEach, test, expect } from 'vitest';
import { decideActivation } from '@wabagent/contracts';
import { StepActivate } from '../step-activate';
import type { WizardState } from '@/lib/bot-draft';
import { accountView, numberView } from '@/components/connections/__tests__/fixtures';
import { json, renderIntl, stubFetch } from '@/components/connections/__tests__/helpers';

// revue finale M-7 : l'étape Activer annonce le refus avant l'envoi avec la décision des contrats (`decideActivation`),
// la même que les deux pilotes appellent dans leur transaction. Le web n'écrit pas la règle lui-même.
vi.mock('@wabagent/contracts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wabagent/contracts')>();
  return { ...actual, decideActivation: vi.fn(actual.decideActivation) };
});

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const decide = vi.mocked(decideActivation);

// `mockReset` remet l'implémentation d'origine (la vraie décision des contrats) entre deux tests.
beforeEach(() => {
  decide.mockReset();
});

const state: WizardState = {
  name: 'Conseil beauté Marais v2', slug: 'conseil-beaute-marais-v2', languages: ['fr'], defaultLanguage: 'fr',
  perLang: { fr: { mode: 'guided', role: 'Conseiller', tones: [], objective: '', info: '', raw: '' } },
  welcomeEnabled: true, welcome: {}, leadFields: [], entityId: null,
};

const free = numberView({ id: 1, phone_e164: '+33612457890', display_name: 'Maison Lumière Marais' });

function renderStep(entries: string[]) {
  stubFetch(() => json([accountView({ id: 1, name: 'Maison Lumière France', last_verified_at: new Date().toISOString(), numbers: [free] })]));
  renderIntl(
    <StepActivate
      botId="conseil-beaute-marais-v2" numberId={1} state={state} entries={entries} onEntriesChange={vi.fn()} entityId={null} entities={[]}
      onBack={vi.fn()} onLater={vi.fn()} onActivated={vi.fn()}
    />,
  );
}

test("l'étape Activer appelle decideActivation avec le statut demandé et les faits lus (brouillon, numéro, compte, liste)", async () => {
  renderStep([]);
  await screen.findByText('Compte WhatsApp connecté', { exact: false });
  expect(decide).toHaveBeenCalledWith('limited', {
    from: 'draft',
    number: { present: true, is_test: false, account_state: 'connected' },
    allowlistCount: 0,
  });
  expect(screen.getByRole('button', { name: 'Activer en accès limité' })).toBeDisabled();
  expect(screen.getByText('Ajoutez au moins un numéro à la Whitelist pour activer.')).toBeInTheDocument();
});

test('le refus annoncé est celui des contrats, pas une règle du web : un refus forcé désactive le bouton avec sa raison', async () => {
  decide.mockReturnValue({ ok: false, reason: 'account_not_connected' });
  renderStep(['+33612345678']);
  await screen.findByText('Compte WhatsApp connecté', { exact: false });
  expect(screen.getByRole('button', { name: 'Activer en accès limité' })).toBeDisabled();
  expect(screen.getByText("Le compte WhatsApp de ce numéro n'est pas connecté.")).toBeInTheDocument();
});

test('décision acceptée par les contrats : le bouton est actif, sans raison', async () => {
  renderStep(['+33612345678']);
  await screen.findByText('Compte WhatsApp connecté', { exact: false });
  expect(decide).toHaveBeenLastCalledWith('limited', expect.objectContaining({ allowlistCount: 1 }));
  expect(screen.getByRole('button', { name: 'Activer en accès limité' })).toBeEnabled();
});
