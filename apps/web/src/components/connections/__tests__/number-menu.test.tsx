import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { NumberMenu } from '../number-menu';
import { accountView, numberView } from './fixtures';
import { engineError, json, renderIntl, stubFetch } from './helpers';

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

const TRIGGER = 'Actions du numéro +33 6 12 45 78 90';

function renderMenu(over: Parameters<typeof numberView>[0] = {}, account = accountView({ id: 4 })) {
  const onChanged = vi.fn();
  const number = numberView({ id: 8, ...over });
  renderIntl(<NumberMenu account={account} number={number} onChanged={onChanged} />);
  return { onChanged };
}

async function open() {
  await userEvent.click(screen.getByRole('button', { name: TRIGGER }));
}

test('Meta : « Voir dans WhatsApp Manager ↗ » est un lien externe vers la WABA', async () => {
  stubFetch(() => json({}));
  renderMenu();
  await open();
  const link = screen.getByRole('menuitem', { name: 'Voir dans WhatsApp Manager ↗' });
  expect(link).toHaveAttribute('href', 'https://business.facebook.com/wa/manage/phone-numbers/?waba_id=104829371625544');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});

test('CM.com : « Voir dans WhatsApp Manager » est absent', async () => {
  stubFetch(() => json({}));
  renderMenu({}, accountView({ id: 4, mode: 'cm_com', waba_id: null }));
  await open();
  expect(screen.queryByRole('menuitem', { name: /WhatsApp Manager/ })).not.toBeInTheDocument();
});

test('numéro libre : « Brancher sur un agent IA » et pas de « Débrancher »', async () => {
  stubFetch(() => json({}));
  renderMenu();
  await open();
  expect(screen.getByRole('menuitem', { name: 'Brancher sur un agent IA' })).toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: 'Débrancher' })).not.toBeInTheDocument();
});

test('numéro branché : « Changer d\'agent IA » et « Débrancher »', async () => {
  stubFetch(() => json({}));
  renderMenu({ bot: { bot_id: 'conseil', name: 'Conseil Marais', status: 'limited' } });
  await open();
  expect(screen.getByRole('menuitem', { name: "Changer d'agent IA" })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Débrancher' })).toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: 'Brancher sur un agent IA' })).not.toBeInTheDocument();
});

test('marquer comme numéro de test : explication, puis PATCH avec is_test true', async () => {
  const calls = stubFetch(() => json(accountView({ id: 4 })));
  const { onChanged } = renderMenu();
  await open();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Marquer comme numéro de test' }));
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveTextContent('Un numéro de test peut être ouvert à tous sans passer par l\'accès limité');
  await userEvent.click(screen.getByRole('button', { name: 'Marquer comme numéro de test' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(calls).toEqual([{ url: '/api/whatsapp-accounts/4/numbers/8', method: 'PATCH', body: { is_test: true } }]);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('numéro de test : « Ce n\'est pas un numéro de test » envoie is_test false', async () => {
  const calls = stubFetch(() => json(accountView({ id: 4 })));
  const { onChanged } = renderMenu({ is_test: true });
  await open();
  expect(screen.queryByRole('menuitem', { name: 'Marquer comme numéro de test' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('menuitem', { name: "Ce n'est pas un numéro de test" }));
  await userEvent.click(screen.getByRole('button', { name: "Ce n'est pas un numéro de test" }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(calls[0]).toEqual({ url: '/api/whatsapp-accounts/4/numbers/8', method: 'PATCH', body: { is_test: false } });
});

test('marquage refusé : message du moteur, onChanged non appelé', async () => {
  stubFetch(() => engineError(404, 'NOT_FOUND', 'Numéro WhatsApp introuvable.'));
  const { onChanged } = renderMenu();
  await open();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Marquer comme numéro de test' }));
  await userEvent.click(screen.getByRole('button', { name: 'Marquer comme numéro de test' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Numéro WhatsApp introuvable.');
  expect(onChanged).not.toHaveBeenCalled();
});

test('Débrancher : la confirmation nomme l\'agent IA, DELETE puis onChanged', async () => {
  const calls = stubFetch(() => json({ bot_id: 'conseil-marais' }));
  const { onChanged } = renderMenu({ bot: { bot_id: 'conseil-marais', name: 'Conseil Marais', status: 'active' } });
  await open();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Débrancher' }));
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveTextContent('Conseil Marais');
  expect(dialog).toHaveTextContent(/repasse en brouillon/);
  await userEvent.click(screen.getByRole('button', { name: "Débrancher l'agent IA" }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(calls).toEqual([{ url: '/api/bots/conseil-marais/number', method: 'DELETE', body: undefined }]);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('Débrancher refusé : message du moteur, la fenêtre reste ouverte', async () => {
  stubFetch(() => engineError(404, 'NOT_FOUND', 'Agent IA introuvable.'));
  const { onChanged } = renderMenu({ bot: { bot_id: 'conseil', name: 'Conseil Marais', status: 'draft' } });
  await open();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Débrancher' }));
  await userEvent.click(screen.getByRole('button', { name: "Débrancher l'agent IA" }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Agent IA introuvable.');
  expect(onChanged).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('Brancher sur un agent IA ouvre la fenêtre de choix', async () => {
  stubFetch(() => json([{ bot_id: 'sav', name: 'SAV commandes', status: 'draft', whatsapp_number: null }]));
  renderMenu();
  await open();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Brancher sur un agent IA' }));
  expect(screen.getByRole('dialog', { name: 'Brancher le numéro sur un agent IA' })).toBeInTheDocument();
  expect(await screen.findByRole('radio', { name: /SAV commandes/ })).toBeInTheDocument();
});

test('démarquage : titre et texte (un agent IA actif reste ouvert à tous)', async () => {
  stubFetch(() => json(accountView({ id: 4 })));
  renderMenu({ is_test: true });
  await open();
  await userEvent.click(screen.getByRole('menuitem', { name: "Ce n'est pas un numéro de test" }));
  const dialog = screen.getByRole('dialog', { name: 'Retirer le marquage de test de +33 6 12 45 78 90 ?' });
  expect(dialog).toHaveTextContent('Un agent IA déjà actif sur ce numéro reste ouvert à tous.');
});

test.each([
  ['Marquer comme numéro de test', {}],
  ["Ce n'est pas un numéro de test", { is_test: true }],
  ['Brancher sur un agent IA', {}],
  ['Débrancher', { bot: { bot_id: 'c', name: 'Conseil', status: 'draft' } }],
])('« %s » : à la fermeture de la fenêtre, le focus revient au bouton « ⋯ »', async (item, over) => {
  stubFetch(() => json([]));
  renderMenu(over);
  await open();
  await userEvent.click(screen.getByRole('menuitem', { name: item }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Annuler' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: TRIGGER })).toHaveFocus();
});
