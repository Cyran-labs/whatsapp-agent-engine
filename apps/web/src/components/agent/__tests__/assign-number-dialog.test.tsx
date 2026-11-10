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
  bot: { bot_id: 'support', name: 'Support technique', status: 'active' },
});
const heldByDraft = numberView({ id: 4, phone_e164: '+33198765432', display_name: 'Brouillon', bot: { bot_id: 'essai', name: 'Essai', status: 'draft' } });

function renderDialog(locale: 'fr' | 'en' = 'fr') {
  stubFetch(() => json([accountView({ numbers: [held, heldByDraft] })]));
  renderIntl(<AssignNumberDialog botId="b1" bot={{ name: 'Conseil Marais', status: 'draft' }} currentNumber={null} onClose={vi.fn()} onDone={vi.fn()} />, locale);
}

// recette 10 nov. 2026 : le branchement depuis la page de l'agent IA est immédiat, le texte de l'assistant (« À l'activation ») est faux ici.
test('numéro d\'un agent IA en service : l\'avertissement dit que le débranchement est immédiat', async () => {
  renderDialog();
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(await within(dialog).findByRole('radio', { name: /\+1 555 164 9072/ }));
  const warning = within(dialog).getByText(/sera débranché de ce numéro/);
  expect(warning).toHaveTextContent('Support technique sera débranché de ce numéro tout de suite et passera en Désactivé : il ne répondra plus.');
  expect(dialog).not.toHaveTextContent("À l'activation");
});

test('numéro d\'un agent IA qui ne répond pas : débranché tout de suite, sans mention de Désactivé', async () => {
  renderDialog();
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(await within(dialog).findByRole('radio', { name: /\+33 1 98 76 54 32/ }));
  const warning = within(dialog).getByText(/sera débranché de ce numéro/);
  expect(warning).toHaveTextContent('Essai sera débranché de ce numéro tout de suite.');
  expect(warning).not.toHaveTextContent('Désactivé');
});

test('en anglais : « right away »', async () => {
  renderDialog('en');
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(await within(dialog).findByRole('radio', { name: /\+1 555 164 9072/ }));
  expect(within(dialog).getByText(/will be unassigned from this number/)).toHaveTextContent(
    'Support technique will be unassigned from this number right away and will go to Deactivated: it will stop answering.',
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
