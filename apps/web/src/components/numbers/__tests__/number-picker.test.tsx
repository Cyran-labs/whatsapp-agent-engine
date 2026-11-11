import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect } from 'vitest';
import { NumberPicker } from '../number-picker';
import { accountView, numberView } from '@/components/connections/__tests__/fixtures';
import { renderIntl } from '@/components/connections/__tests__/helpers';

const marais = numberView({ id: 1, phone_e164: '+33612457890', display_name: 'Maison Lumière Marais' });
const standard = numberView({
  id: 2,
  phone_e164: '+33184801234',
  display_name: 'Maison Lumière',
  bot: { bot_id: 'support-client', name: 'Support client', status: 'active', status_reason: null, not_responding: null },
});
const sandbox = numberView({
  id: 3,
  phone_e164: '+15550132291',
  display_name: 'Test Number',
  is_test: true,
  bot: { bot_id: 'conseil-beaute', name: 'Conseil beauté Marais', status: 'limited', status_reason: null, not_responding: null },
});

const france = accountView({ id: 1, name: 'Maison Lumière France', numbers: [marais, standard] });
const test_ = accountView({ id: 2, name: 'Sandbox de test', is_test: true, numbers: [sandbox] });

function renderPicker(props: Partial<React.ComponentProps<typeof NumberPicker>> = {}) {
  const onSelect = vi.fn();
  renderIntl(
    <NumberPicker accounts={[france, test_]} selectedId={null} currentBotId={null} onSelect={onSelect} {...props} />,
  );
  return onSelect;
}

test('groupe les numéros par compte et marque un numéro libre', () => {
  renderPicker();
  const groupFrance = screen.getByRole('group', { name: 'Maison Lumière France' });
  expect(within(groupFrance).getAllByRole('radio')).toHaveLength(2);
  expect(within(groupFrance).getByText(/Maison Lumière Marais · libre/)).toBeInTheDocument();
  const groupSandbox = screen.getByRole('group', { name: 'Sandbox de test' });
  expect(within(groupSandbox).getAllByRole('radio')).toHaveLength(1);
});

test('un numéro branché sur un autre agent IA reste choisissable et le dit', async () => {
  const onSelect = renderPicker();
  expect(screen.getByText('Utilisé par Support client')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('radio', { name: /\+33 1 84 80 12 34/ }));
  expect(onSelect).toHaveBeenCalledWith(2);
});

test('l\'avertissement nomme l\'agent IA qui sera débranché une fois le numéro choisi, pas avant', () => {
  const { unmount } = renderIntl(
    <NumberPicker accounts={[france, test_]} selectedId={null} currentBotId={null} onSelect={vi.fn()} />,
  );
  expect(screen.queryByText(/sera débranché de ce numéro/)).not.toBeInTheDocument();
  unmount();
  renderPicker({ selectedId: 2 });
  const warning = screen.getByText(/sera débranché de ce numéro/);
  expect(warning).toHaveTextContent('À l\'activation, Support client sera débranché de ce numéro et passera Offline : il ne répondra plus.'); // décision François A9
  expect(within(warning).getByText('Support client').tagName).toBe('B');
});

test('un agent IA débranché qui n\'est pas en ligne ne reçoit pas la mention « passera en Désactivé »', () => {
  const draftUser = numberView({ id: 4, phone_e164: '+33198765432', bot: { bot_id: 'brouillon', name: 'Essai', status: 'draft', status_reason: null, not_responding: null } });
  renderPicker({ accounts: [accountView({ numbers: [draftUser] })], selectedId: 4 });
  const warning = screen.getByText(/sera débranché de ce numéro/);
  expect(warning).toHaveTextContent('Essai sera débranché de ce numéro.');
  expect(warning).not.toHaveTextContent('Offline');
});

// revue finale 2b-3 m-4 : le badge dit « Numéro de test » comme partout
test('un numéro de test porte le badge « Numéro de test » et rappelle les destinataires déclarés une fois choisi', () => {
  renderPicker({ selectedId: 3 });
  expect(screen.getByText('Numéro de test')).toBeInTheDocument();
  expect(screen.queryByText('Test Meta')).not.toBeInTheDocument();
  expect(screen.getByText(/seuls les destinataires déclarés dans votre app Meta \(5 au plus\)/)).toBeInTheDocument();
  expect(screen.getByText(/sera débranché de ce numéro/)).toHaveTextContent('Conseil beauté Marais sera débranché de ce numéro et passera Offline : il ne répondra plus.');
});

test('le rappel du numéro de test renvoie vers l\'app Meta du compte, dans un nouvel onglet', () => {
  renderPicker({ selectedId: 3 });
  const link = screen.getByRole('link', { name: /Gérer les destinataires dans Meta/ });
  expect(link).toHaveAttribute('href', 'https://developers.facebook.com/apps/1424483510748297/');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
});

test('app Meta inconnue : le lien renvoie vers la liste des apps', () => {
  renderPicker({ accounts: [accountView({ meta_app_id: null, numbers: [sandbox] })], selectedId: 3 });
  expect(screen.getByRole('link', { name: /Gérer les destinataires dans Meta/ })).toHaveAttribute('href', 'https://developers.facebook.com/apps/');
});

test('un compte CM.com marqué de test ne renvoie pas vers une app Meta', () => {
  renderPicker({ accounts: [accountView({ mode: 'cm_com', meta_app_id: null, numbers: [sandbox] })], selectedId: 3 });
  expect(screen.getByText(/seuls les destinataires déclarés/)).toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

test('le rappel du numéro de test n\'apparaît pas tant qu\'il n\'est pas choisi', () => {
  renderPicker({ selectedId: 1 });
  expect(screen.queryByText(/seuls les destinataires déclarés/)).not.toBeInTheDocument();
});

test('le numéro branché sur l\'agent IA courant est marqué « Numéro actuel » et sans avertissement', () => {
  const mine = numberView({ id: 5, phone_e164: '+33611223344', bot: { bot_id: 'ventes', name: 'Ventes', status: 'draft', status_reason: null, not_responding: null } });
  renderPicker({ accounts: [accountView({ numbers: [mine] })], currentBotId: 'ventes', selectedId: 5 });
  expect(screen.getByText('Numéro actuel')).toBeInTheDocument();
  expect(screen.queryByText(/Utilisé par/)).not.toBeInTheDocument();
  expect(screen.queryByText(/sera débranché/)).not.toBeInTheDocument();
});

test('numéro retiré et compte déconnecté absents, compte en erreur signalé', () => {
  const removed = numberView({ id: 6, phone_e164: '+33699999999', provider_state: 'removed', removed_at: '2026-11-01T00:00:00Z' });
  const disconnected = accountView({
    id: 3,
    name: 'Ancien compte',
    state: 'disconnected',
    numbers: [numberView({ id: 7, phone_e164: '+33677777777' })],
  });
  const broken = accountView({ id: 4, name: 'Compte fragile', state: 'error', error_reason: 'token_invalid', numbers: [numberView({ id: 8, phone_e164: '+33688888888' })] });
  renderPicker({ accounts: [accountView({ numbers: [marais, removed] }), disconnected, broken] });
  expect(screen.queryByText(/\+33 6 99 99 99 99/)).not.toBeInTheDocument();
  expect(screen.queryByText(/\+33 6 77 77 77 77/)).not.toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Ancien compte' })).not.toBeInTheDocument();
  const group = screen.getByRole('group', { name: 'Compte fragile' });
  expect(within(group).getByRole('radio', { name: /\+33 6 88 88 88 88/ })).toBeInTheDocument();
  expect(within(group).getByText('Compte en erreur')).toBeInTheDocument();
});

test('un compte sans numéro présent n\'affiche pas de groupe vide', () => {
  const onlyRemoved = accountView({ id: 9, name: 'Vide', numbers: [numberView({ id: 9, provider_state: 'removed' })] });
  renderPicker({ accounts: [onlyRemoved, france] });
  expect(screen.queryByRole('group', { name: 'Vide' })).not.toBeInTheDocument();
});

test('le numéro choisi est coché', () => {
  renderPicker({ selectedId: 1 });
  expect(screen.getByRole('radio', { name: /\+33 6 12 45 78 90/ })).toBeChecked();
  expect(screen.getByRole('radio', { name: /\+33 1 84 80 12 34/ })).not.toBeChecked();
});
