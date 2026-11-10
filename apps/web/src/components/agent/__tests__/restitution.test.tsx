import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach, describe } from 'vitest';
import fr from '../../../../messages/fr.json';
import en from '../../../../messages/en.json';
import { AllowlistPanel } from '../allowlist-panel';
import { AssignNumberDialog } from '../assign-number-dialog';
import { StatusPanel } from '../status-panel';
import { botView } from './fixtures';
import { accountView, numberView } from '@/components/connections/__tests__/fixtures';
import { json, renderIntl, stubFetch } from '@/components/connections/__tests__/helpers';

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

/**
 * Tâche 16b (défauts D-1 et D-2 de la tâche 16) : les panneaux Statut, Numéro et Liste d'accès limité de la page de
 * l'agent IA lisent leur refus avec `describeFailure`. Une panne 500 montre le texte contextuel du panneau et la référence
 * de la requête (audit R-14) ; un refus à clé s'affiche dans la langue de l'interface (audit R-15).
 */

const ENGINE_500 = 'Erreur interne.';
const serverError = (requestId: string): Response =>
  json({ error: { code: 'INTERNAL', message: ENGINE_500, request_id: requestId } }, 500);
const keyedRefusal = (status: number, message: string, reason: string, details?: { path: string; message: string }[]): Response =>
  json({ error: { code: status === 400 ? 'VALIDATION_ERROR' : 'CONFLICT', message, reason, ...(details ? { details } : {}) } }, status);

type Locale = 'fr' | 'en';
const messages = (locale: Locale) => (locale === 'fr' ? fr : en);

async function expectServerFailure(text: string, requestId: string, locale: Locale) {
  const reference = messages(locale).errors.generic.reference.replace('{reference}', requestId);
  const line = await screen.findByText(reference);
  expect(line.closest('[role="alert"]')).toHaveTextContent(text);
  expect(screen.queryByText(ENGINE_500)).not.toBeInTheDocument();
}

const HOLDER_CHANGED_FR = 'Ce numéro a changé depuis votre lecture : vérifiez la liste.';
const INVALID_ENTRY_FR = fr.errors.reasons.allowlist.invalid_entry;
const accounts = [accountView({ id: 1, numbers: [numberView({ id: 8, phone_e164: '+33612457890', display_name: 'Boutique Marais' })] })];

const screens: {
  name: string;
  render: (locale: Locale) => void;
  act: (locale: Locale) => Promise<void>;
  fallback: (locale: Locale) => string;
  keyed: () => Response;
  keyedText: (locale: Locale) => string;
  keyedFr: string;
}[] = [
  {
    name: 'changer le statut',
    render: (locale) => renderIntl(<StatusPanel bot={botView({ status: 'draft', allowlist: ['+33611111111'] })} canEdit onChanged={vi.fn()} />, locale),
    act: async (locale) => userEvent.click(screen.getByRole('button', { name: messages(locale).agentStatus.actions.limit })),
    fallback: (locale) => messages(locale).agentStatus.failed,
    keyed: () => keyedRefusal(409, 'Changement de statut impossible depuis le statut actuel.', 'transition.invalid_transition'),
    keyedText: (locale) => messages(locale).errors.reasons.transition.invalid_transition,
    keyedFr: 'Changement de statut impossible depuis le statut actuel.',
  },
  {
    name: 'brancher ou changer le numéro',
    render: (locale) =>
      renderIntl(<AssignNumberDialog botId="b1" bot={{ name: 'Conseil Marais', status: 'draft' }} currentNumber={null} onClose={vi.fn()} onDone={vi.fn()} />, locale),
    act: async (locale) => {
      const dialog = await screen.findByRole('dialog');
      await userEvent.click(await within(dialog).findByRole('radio', { name: /Boutique Marais/ }));
      await userEvent.click(within(dialog).getByRole('button', { name: messages(locale).agentNumber.dialog.submit }));
    },
    fallback: (locale) => messages(locale).connections.dialogs.failed,
    keyed: () => keyedRefusal(409, HOLDER_CHANGED_FR, 'assign.holder_changed', [{ path: 'expected_bot_id', message: HOLDER_CHANGED_FR }]),
    keyedText: (locale) => messages(locale).errors.reasons.assign.holder_changed,
    keyedFr: HOLDER_CHANGED_FR,
  },
  {
    name: 'enregistrer la liste d\'accès limité',
    render: (locale) => renderIntl(<AllowlistPanel botId="b1" entries={['+33611111111']} canEdit onChanged={vi.fn()} />, locale),
    act: async (locale) => {
      const list = messages(locale).allowlist;
      await userEvent.type(screen.getByLabelText(list.label), '+33622222222');
      await userEvent.click(screen.getByRole('button', { name: list.add }));
      await userEvent.click(screen.getByRole('button', { name: messages(locale).agentAllowlist.save }));
    },
    fallback: (locale) => messages(locale).agentAllowlist.failed,
    // l'entrée refusée porte le texte de la clé sous sa ligne
    keyed: () => keyedRefusal(400, 'Données invalides.', 'allowlist.invalid_entry', [{ path: 'entries.1', message: INVALID_ENTRY_FR }]),
    keyedText: (locale) => messages(locale).errors.reasons.allowlist.invalid_entry,
    keyedFr: INVALID_ENTRY_FR,
  },
];

function engine(write: () => Response) {
  stubFetch((call) => (call.url === '/api/whatsapp-accounts' && call.method === 'GET' ? json(accounts) : write()));
}

describe.each(screens)('page de l\'agent IA, $name', ({ render, act, fallback, keyed, keyedText, keyedFr }) => {
  // audit R-14
  test.each(['fr', 'en'] as const)('panne 500 (%s) : texte contextuel du panneau et référence de la requête, jamais « Erreur interne. »', async (locale) => {
    engine(() => serverError(`req-agt-${locale}`));
    render(locale);
    await act(locale);
    await expectServerFailure(fallback(locale), `req-agt-${locale}`, locale);
  });

  // audit R-15
  test('refus à clé en anglais : texte anglais de la clé, jamais le texte français du moteur', async () => {
    engine(keyed);
    render('en');
    await act('en');
    expect(await screen.findByText(keyedText('en'))).toBeInTheDocument();
    expect(screen.queryByText(keyedFr)).not.toBeInTheDocument();
  });
});
