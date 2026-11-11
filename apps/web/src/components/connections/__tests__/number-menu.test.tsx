import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
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

const TRIGGER = 'Gérer (+33 6 12 45 78 90)';
const REASON = "Le compte WhatsApp de ce numéro n'est pas connecté : un agent IA branché ici ne répondrait pas.";

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
  renderMenu({ bot: { bot_id: 'conseil', name: 'Conseil Marais', status: 'limited', status_reason: null, not_responding: null } });
  await open();
  expect(screen.getByRole('menuitem', { name: "Changer d'agent IA" })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Débrancher' })).toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: 'Brancher sur un agent IA' })).not.toBeInTheDocument();
});

// prototype 17 : le menu d'un numéro d'un compte en erreur ne propose plus « Changer d'agent IA » sans dire pourquoi
test('prototype 17 : compte en erreur, « Changer d\'agent IA » grisé avec sa raison, sans fenêtre au clic', async () => {
  stubFetch(() => json({}));
  renderMenu(
    { bot: { bot_id: 'conseil', name: 'Conseil Marais', status: 'limited', status_reason: null, not_responding: 'account_not_connected' } },
    accountView({ id: 4, state: 'error', error_reason: 'token_invalid' }),
  );
  await open();
  const change = screen.getByRole('menuitem', { name: "Changer d'agent IA" });
  expect(change).toHaveAttribute('aria-disabled', 'true');
  expect(change).toHaveAccessibleDescription(REASON);
  await userEvent.click(change);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Débrancher' })).not.toHaveAttribute('aria-disabled');
});

// décision du contrôleur (relecture tâche 10) : brancher sur un numéro libre d'un compte en erreur créerait un agent IA
// qui ne répond pas ; la raison dit ce qui arriverait, pas un refus que le moteur ne donne pas (m-6)
test('compte en erreur, numéro libre : « Brancher sur un agent IA » grisé avec sa raison, sans fenêtre au clic', async () => {
  stubFetch(() => json({}));
  renderMenu({}, accountView({ id: 4, state: 'error', error_reason: 'token_invalid' }));
  await open();
  const assign = screen.getByRole('menuitem', { name: 'Brancher sur un agent IA' });
  expect(assign).toHaveAttribute('aria-disabled', 'true');
  expect(assign).toHaveAccessibleDescription(REASON);
  await userEvent.click(assign);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('compte connecté : « Changer d\'agent IA » actif', async () => {
  stubFetch(() => json({}));
  renderMenu({ bot: { bot_id: 'conseil', name: 'Conseil Marais', status: 'limited', status_reason: null, not_responding: null } });
  await open();
  expect(screen.getByRole('menuitem', { name: "Changer d'agent IA" })).not.toHaveAttribute('aria-disabled');
});

// revue finale 2b-3 I-3 : numéro retiré chez le fournisseur, le menu se réduit à ce qui a encore un sens
test('numéro retiré et libre : seul le lien WhatsApp Manager ; ni brancher, ni marquage de test', async () => {
  stubFetch(() => json({}));
  renderMenu({ provider_state: 'removed', removed_at: '2026-11-01T10:00:00.000Z', is_test: true });
  await open();
  expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Voir dans WhatsApp Manager ↗']);
});

test('numéro retiré encore branché : « Débrancher » et le lien WhatsApp Manager, pas de changement d\'agent IA ni de marquage', async () => {
  stubFetch(() => json({}));
  renderMenu({ provider_state: 'removed', removed_at: '2026-11-01T10:00:00.000Z', bot: { bot_id: 'conseil', name: 'Conseil Marais', status: 'paused', status_reason: null, not_responding: null } });
  await open();
  expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Débrancher', 'Voir dans WhatsApp Manager ↗']);
});

test('numéro retiré, libre, compte CM.com : aucune action, donc pas de menu', () => {
  stubFetch(() => json({}));
  renderMenu({ provider_state: 'removed', removed_at: '2026-11-01T10:00:00.000Z' }, accountView({ id: 4, mode: 'cm_com', waba_id: null }));
  expect(screen.queryByRole('button', { name: TRIGGER })).not.toBeInTheDocument();
});

test('marquer comme numéro de test : explication, puis PATCH avec is_test true', async () => {
  const calls = stubFetch(() => json(accountView({ id: 4 })));
  const { onChanged } = renderMenu();
  await open();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Marquer comme numéro de test' }));
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveTextContent('Un agent IA sur un numéro de test peut passer Online sans passer par Preview');
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

test('Débrancher : la confirmation nomme l\'agent IA, POST unassign avec le numéro affiché puis onChanged', async () => {
  const calls = stubFetch(() => json({ bot_id: 'conseil-marais' }));
  const { onChanged } = renderMenu({ bot: { bot_id: 'conseil-marais', name: 'Conseil Marais', status: 'active', status_reason: null, not_responding: null } });
  await open();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Débrancher' }));
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveTextContent('Conseil Marais');
  // décision François A9
  expect(dialog).toHaveTextContent('Conseil Marais passera Offline : il ne répondra plus.');
  expect(dialog).not.toHaveTextContent(/Draft/);
  await userEvent.click(screen.getByRole('button', { name: "Débrancher l'agent IA" }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  // revue finale 2b-3 I-2 : le numéro que l'écran affichait accompagne la demande
  expect(calls).toEqual([{ url: '/api/bots/conseil-marais/number/unassign', method: 'POST', body: { expected_number_id: 8 } }]);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('Débrancher refusé : message du moteur, la fenêtre reste ouverte', async () => {
  stubFetch(() => engineError(404, 'NOT_FOUND', 'Agent IA introuvable.'));
  const { onChanged } = renderMenu({ bot: { bot_id: 'conseil', name: 'Conseil Marais', status: 'draft', status_reason: null, not_responding: null } });
  await open();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Débrancher' }));
  await userEvent.click(screen.getByRole('button', { name: "Débrancher l'agent IA" }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Agent IA introuvable.');
  expect(onChanged).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

// revue finale 2b-3 I-2 : l'agent IA a pris un autre numéro depuis la lecture de la page
test('Débrancher : 409 « Ce numéro a changé », message affiché, relecture demandée, pas de nouvel envoi, la fenêtre survit à la relecture', async () => {
  const stale = 'Ce numéro a changé depuis votre lecture : vérifiez la liste.';
  const calls = stubFetch(() => engineError(409, 'CONFLICT', stale, [{ path: 'expected_bot_id', message: stale }]));
  const onChanged = vi.fn();
  const account = accountView({ id: 4 });
  const withBot = numberView({ id: 8, bot: { bot_id: 'conseil-marais', name: 'Conseil Marais', status: 'active', status_reason: null, not_responding: null } });
  const { rerender } = renderIntl(<NumberMenu account={account} number={withBot} onChanged={onChanged} />);
  await open();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Débrancher' }));
  await userEvent.click(screen.getByRole('button', { name: "Débrancher l'agent IA" }));
  expect(await screen.findByRole('alert')).toHaveTextContent(stale);
  expect(onChanged).toHaveBeenCalledTimes(1);
  // la relecture montre le numéro libre : la fenêtre et le refus restent affichés, plus de bouton de confirmation
  rerender(<NextIntlClientProvider locale="fr" messages={messages}><NumberMenu account={account} number={numberView({ id: 8, bot: null })} onChanged={onChanged} /></NextIntlClientProvider>);
  expect(screen.getByRole('dialog')).toHaveTextContent(stale);
  expect(screen.queryByRole('button', { name: "Débrancher l'agent IA" })).not.toBeInTheDocument();
  expect(calls).toHaveLength(1);
});

test('Brancher sur un agent IA ouvre la fenêtre de choix', async () => {
  stubFetch(() => json([{ bot_id: 'sav', name: 'SAV commandes', status: 'draft', whatsapp_number: null }]));
  renderMenu();
  await open();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Brancher sur un agent IA' }));
  expect(screen.getByRole('dialog', { name: 'Brancher le numéro sur un agent IA' })).toBeInTheDocument();
  expect(await screen.findByRole('radio', { name: /SAV commandes/ })).toBeInTheDocument();
});

test('démarquage : titre et texte (un agent IA déjà ouvert à tous le reste)', async () => {
  stubFetch(() => json(accountView({ id: 4 })));
  renderMenu({ is_test: true });
  await open();
  await userEvent.click(screen.getByRole('menuitem', { name: "Ce n'est pas un numéro de test" }));
  const dialog = screen.getByRole('dialog', { name: 'Retirer le marquage de test de +33 6 12 45 78 90 ?' });
  expect(dialog).toHaveTextContent('Un agent IA déjà Online sur ce numéro le reste.');
});

test.each([
  ['Marquer comme numéro de test', {}],
  ["Ce n'est pas un numéro de test", { is_test: true }],
  ['Brancher sur un agent IA', {}],
  ['Débrancher', { bot: { bot_id: 'c', name: 'Conseil', status: 'draft', status_reason: null, not_responding: null } }],
])('« %s » : à la fermeture de la fenêtre, le focus revient au bouton « Gérer »', async (item, over) => {
  stubFetch(() => json([]));
  renderMenu(over);
  await open();
  await userEvent.click(screen.getByRole('menuitem', { name: item }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Annuler' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: TRIGGER })).toHaveFocus();
});
