import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { AssignNumberDialog } from '../assign-number-dialog';
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

const held = numberView({
  id: 3,
  phone_e164: '+15551649072',
  display_name: 'Test Number',
  is_test: true,
  bot: { bot_id: 'support', name: 'Support technique', status: 'active', status_reason: null, not_responding: null },
});
const heldByDraft = numberView({ id: 4, phone_e164: '+33198765432', display_name: 'Brouillon', bot: { bot_id: 'essai', name: 'Essai', status: 'draft', status_reason: null, not_responding: null } });

/** Avertissement de débranchement qui nomme `bot` (tous sont visibles avant le choix). */
function warningFor(scope: HTMLElement, pattern: RegExp, bot: string): HTMLElement {
  const found = within(scope).getAllByText(pattern).find((el) => el.textContent?.includes(bot));
  if (!found) throw new Error(`[Test] aucun avertissement pour ${bot}`);
  return found;
}

function renderDialog(locale: 'fr' | 'en' = 'fr') {
  stubFetch(() => json([accountView({ numbers: [held, heldByDraft] })]));
  renderIntl(<AssignNumberDialog botId="b1" bot={{ name: 'Conseil Marais', status: 'draft' }} currentNumber={null} onClose={vi.fn()} onDone={vi.fn()} />, locale);
}

// recette 10 nov. 2026 : le branchement depuis la page de l'agent IA est immédiat, le texte de l'assistant (« À l'activation ») est faux ici.
test('numéro d\'un agent IA en service : l\'avertissement dit que le débranchement est immédiat', async () => {
  renderDialog();
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(await within(dialog).findByRole('radio', { name: /\+1 555 164 9072/ }));
  const warning = warningFor(dialog, /sera débranché de ce numéro/, 'Support technique');
  expect(warning).toHaveTextContent('Support technique sera débranché de ce numéro tout de suite et passera Offline : il ne répondra plus.');
  expect(dialog).not.toHaveTextContent("À l'activation");
});

test('numéro d\'un agent IA qui ne répond pas : débranché tout de suite, sans mention de Désactivé', async () => {
  renderDialog();
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(await within(dialog).findByRole('radio', { name: /\+33 1 98 76 54 32/ }));
  const warning = warningFor(dialog, /sera débranché de ce numéro/, 'Essai');
  expect(warning).toHaveTextContent('Essai sera débranché de ce numéro tout de suite.');
  expect(warning).not.toHaveTextContent('Offline');
});

test('en anglais : « right away »', async () => {
  renderDialog('en');
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(await within(dialog).findByRole('radio', { name: /\+1 555 164 9072/ }));
  expect(warningFor(dialog, /will be unassigned from this number/, 'Support technique')).toHaveTextContent(
    'Support technique will be unassigned from this number right away and will go Offline: it will stop answering.',
  );
});

// recette 10 nov. 2026 : le numéro était coupé sur six lignes (« +1 / 555 / 164 / ... ») à côté de deux pastilles.
test('le numéro reste sur une ligne ; les pastilles sont sous le numéro, à la ligne si besoin', async () => {
  renderDialog();
  const dialog = await screen.findByRole('dialog');
  const radio = await within(dialog).findByRole('radio', { name: /\+1 555 164 9072/ });
  const label = radio.closest('label') as HTMLElement;
  const phone = within(label).getByText('+1 555 164 9072');
  expect(phone).toHaveClass('whitespace-nowrap');
  const testBadge = within(label).getByText('Numéro de test');
  const usedBadge = within(label).getByText('Utilisé par Support technique');
  // les deux pastilles partagent un conteneur qui passe à la ligne, dans la même colonne que le numéro (donc dessous)
  expect(testBadge.parentElement).toBe(usedBadge.parentElement);
  expect(testBadge.parentElement).toHaveClass('flex-wrap');
  expect(testBadge.parentElement?.parentElement).toBe(phone.parentElement);
});

// décision du contrôleur (tour 1) : même règle que l'assistant, compte en erreur non choisissable, avertissement avant le choix
test('compte en erreur : numéros non choisissables avec la raison sous le compte, « Brancher » reste impossible', async () => {
  stubFetch(() => json([
    accountView({ numbers: [heldByDraft] }),
    accountView({ id: 2, name: 'Compte Lyon', state: 'error', error_reason: 'token_invalid', numbers: [numberView({ id: 8, phone_e164: '+33688888888' })] }),
  ]));
  renderIntl(<AssignNumberDialog botId="b1" bot={{ name: 'Conseil Marais', status: 'draft' }} currentNumber={null} onClose={vi.fn()} onDone={vi.fn()} />);
  const dialog = await screen.findByRole('dialog');
  const radio = await within(dialog).findByRole('radio', { name: /\+33 6 88 88 88 88/ });
  expect(radio).toBeDisabled();
  expect(within(dialog).getByText("Le compte WhatsApp de ce numéro n'est pas connecté.")).toBeInTheDocument();
  await userEvent.click(radio);
  expect(radio).not.toBeChecked();
});

test('avertissement visible avant le choix', async () => {
  renderDialog();
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByRole('radio', { name: /\+1 555 164 9072/ });
  expect(warningFor(dialog, /sera débranché de ce numéro tout de suite/, 'Support technique')).toBeInTheDocument();
  expect(within(dialog).getByRole('radio', { name: /\+1 555 164 9072/ })).not.toBeChecked();
});

// re-relecture tâche 13, N-5 : même raison que l'étape Numéro de l'assistant quand aucun numéro n'est utilisable
test('tous les comptes en erreur : « Brancher » dit qu\'aucun numéro n\'est utilisable, pas « Choisissez un numéro »', async () => {
  stubFetch(() => json([
    accountView({ id: 2, name: 'Compte Lyon', state: 'error', error_reason: 'token_invalid', numbers: [numberView({ id: 8, phone_e164: '+33688888888' })] }),
  ]));
  renderIntl(<AssignNumberDialog botId="b1" bot={{ name: 'Conseil Marais', status: 'draft' }} currentNumber={null} onClose={vi.fn()} onDone={vi.fn()} />);
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByRole('radio', { name: /\+33 6 88 88 88 88/ });
  const submit = within(dialog).getByRole('button', { name: 'Brancher ce numéro' });
  expect(submit).toBeDisabled();
  const reasonId = submit.getAttribute('aria-describedby');
  expect(reasonId).not.toBeNull();
  expect(document.getElementById(reasonId!)).toHaveTextContent("Aucun numéro n'est utilisable : le compte WhatsApp n'est pas connecté. Réparez-le dans Connexions.");
  expect(within(dialog).queryByText('Choisissez un numéro pour continuer.')).not.toBeInTheDocument();
});
