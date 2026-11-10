import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { TRANSITION_MESSAGES } from '@wabagent/contracts';
import { StatusPanel } from '../status-panel';
import { botNumber, botView } from './fixtures';
import { engineError, isReadableMuted, json, renderIntl, stubFetch } from '@/components/connections/__tests__/helpers';

beforeEach(() => {
  vi.restoreAllMocks();
});

function renderPanel(bot = botView(), canEdit = true) {
  const onChanged = vi.fn();
  renderIntl(<StatusPanel bot={bot} canEdit={canEdit} onChanged={onChanged} />);
  return { onChanged };
}

test('admin, accès limité : ouvrir à tous et désactiver', () => {
  renderPanel();
  expect(screen.getByText('Accès limité')).toBeInTheDocument();
  for (const name of ['Ouvrir à tous', 'Désactiver']) {
    expect(screen.getByRole('button', { name })).toBeEnabled();
  }
  expect(screen.queryByRole('button', { name: /Revenir en accès limité/ })).not.toBeInTheDocument();
});

// recette Q-1 : les statuts disent l'activation, jamais « brouillon » ni « pause » dans une action
test('recette Q-1 : aucune action de statut ne parle de brouillon ou de pause, quel que soit le statut', () => {
  for (const status of ['draft', 'limited', 'active', 'paused'] as const) {
    renderPanel(botView({ status, whatsapp_number: botNumber({ is_test: true }) }));
    const row = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    for (const label of row) expect(label).not.toMatch(/brouillon|pause/i);
    cleanup();
  }
});

// recette Q-1
test('recette Q-1 : désactivé, deux actions de réactivation et le mot Désactivé sur la pastille', () => {
  renderPanel(botView({ status: 'paused' }));
  expect(screen.getByText('Désactivé')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Réactiver en accès limité' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Réactiver pour tous' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Désactiver' })).not.toBeInTheDocument();
});

// recette Q-1 : l'écran n'envoie jamais `draft`
test('recette Q-1 : parcourir toutes les actions de tous les statuts n\'envoie jamais draft', async () => {
  for (const status of ['draft', 'limited', 'active', 'paused'] as const) {
    const calls = stubFetch(() => json({}));
    renderPanel(botView({ status, whatsapp_number: botNumber({ is_test: true }) }));
    for (const button of screen.getAllByRole('button')) {
      if (!(button as HTMLButtonElement).disabled) await userEvent.click(button);
      const dialog = screen.queryByRole('dialog');
      if (dialog) await userEvent.click(within(dialog).getAllByRole('button').at(-1)!);
    }
    for (const call of calls) expect(call.body).not.toEqual({ status: 'draft' });
    cleanup();
  }
});

test('admin, brouillon : « Ouvrir à tous » indisponible avec sa raison visible sous le bouton', () => {
  renderPanel(botView({ status: 'draft' }));
  expect(screen.getByRole('button', { name: 'Activer en accès limité' })).toBeEnabled();
  const open = screen.getByRole('button', { name: 'Ouvrir à tous' });
  expect(open).toBeDisabled();
  const reason = screen.getByText(new RegExp(TRANSITION_MESSAGES.not_from_draft));
  expect(reason).toBeVisible();
  // La ligne nomme l'action et dit pourquoi.
  expect(reason).toHaveTextContent(`Ouvrir à tous : ${TRANSITION_MESSAGES.not_from_draft}`);
  expect(open).toHaveAccessibleDescription(`Ouvrir à tous : ${TRANSITION_MESSAGES.not_from_draft}`);
});

test('les raisons sont sous la rangée de boutons : une raison ne décale pas les boutons', () => {
  renderPanel(botView({ status: 'active', whatsapp_number: botNumber({ account_state: 'error' }) }));
  const row = screen.getByRole('button', { name: 'Désactiver' }).closest('ul')!;
  const reason = screen.getByText(new RegExp(TRANSITION_MESSAGES.account_not_connected));
  expect(row).not.toContainElement(reason);
  expect(within(row).getAllByRole('button')).toHaveLength(2);
  expect(row.compareDocumentPosition(reason) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // Une ligne par action indisponible, qui la nomme.
  expect(reason).toHaveTextContent(`Revenir en accès limité : ${TRANSITION_MESSAGES.account_not_connected}`);
});

test('brouillon sur un numéro de test : « Ouvrir à tous » permis', () => {
  renderPanel(botView({ status: 'draft', whatsapp_number: botNumber({ is_test: true }) }));
  expect(screen.getByRole('button', { name: 'Ouvrir à tous' })).toBeEnabled();
});

test('liste vide : entrer en accès limité est indisponible avec la phrase du moteur', () => {
  renderPanel(botView({ status: 'paused', allowlist: [] }));
  const resume = screen.getByRole('button', { name: 'Réactiver en accès limité' });
  expect(resume).toBeDisabled();
  expect(resume).toHaveAccessibleDescription(`Réactiver en accès limité : ${TRANSITION_MESSAGES.empty_allowlist}`);
});

test('actif : « Revenir en accès limité »', () => {
  renderPanel(botView({ status: 'active' }));
  expect(screen.getByRole('button', { name: 'Revenir en accès limité' })).toBeEnabled();
});

test('compte du numéro en erreur : limited et active indisponibles, raison affichée', () => {
  renderPanel(botView({ status: 'paused', whatsapp_number: botNumber({ account_state: 'error' }) }));
  expect(screen.getByRole('button', { name: 'Réactiver en accès limité' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Réactiver pour tous' })).toBeDisabled();
  expect(screen.getAllByText(new RegExp(TRANSITION_MESSAGES.account_not_connected))).toHaveLength(2);
});

test('pause automatique pour numéro retiré : le motif est dit', () => {
  renderPanel(botView({ status: 'paused', status_reason: 'number_removed', whatsapp_number: botNumber({ present: false }) }));
  expect(screen.getByText('Désactivé : son numéro a été retiré chez le fournisseur')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Réactiver en accès limité' })).toBeDisabled();
});

test('« Désactiver » (confirmé) envoie PUT /status avec { status: "paused" } puis relit la page', async () => {
  const calls = stubFetch(() => json({}));
  const { onChanged } = renderPanel();
  await userEvent.click(screen.getByRole('button', { name: 'Désactiver' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Désactiver' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(calls).toEqual([{ url: '/api/bots/b1/status', method: 'PUT', body: { status: 'paused' } }]);
});

// revue finale 2b-3 m-7 : « Ouvrir à tous » et « Désactiver » se confirment
test('« Ouvrir à tous » : confirmation qui dit que l\'agent IA répondra à tous les contacts, avec le coût ; rien n\'est envoyé avant', async () => {
  const calls = stubFetch(() => json({}));
  const { onChanged } = renderPanel();
  await userEvent.click(screen.getByRole('button', { name: 'Ouvrir à tous' }));
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveTextContent('Ouvrir Conseil Marais à tous ?');
  expect(dialog).toHaveTextContent('répondra à tous les contacts');
  expect(dialog).toHaveTextContent('coût');
  expect(calls).toEqual([]);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Ouvrir à tous' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(calls).toEqual([{ url: '/api/bots/b1/status', method: 'PUT', body: { status: 'active' } }]);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('« Désactiver » depuis l\'accès limité ou ouvert à tous : confirmation qui dit que l\'agent IA cesse de répondre', async () => {
  for (const status of ['limited', 'active'] as const) {
    const calls = stubFetch(() => json({}));
    const { onChanged } = renderPanel(botView({ status }));
    await userEvent.click(screen.getByRole('button', { name: 'Désactiver' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Désactiver Conseil Marais ?');
    expect(dialog).toHaveTextContent('cessera de répondre');
    expect(dialog).toHaveTextContent('vous pourrez le réactiver');
    expect(calls).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Désactiver' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([{ url: '/api/bots/b1/status', method: 'PUT', body: { status: 'paused' } }]);
    cleanup();
  }
});

// recette Q-1 : la fenêtre porte le mot de l'action choisie, pas celui d'une autre
test('« Réactiver pour tous » se confirme dans sa propre fenêtre et envoie active', async () => {
  const calls = stubFetch(() => json({}));
  renderPanel(botView({ status: 'paused' }));
  await userEvent.click(screen.getByRole('button', { name: 'Réactiver pour tous' }));
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveTextContent('Réactiver Conseil Marais pour tous ?');
  expect(dialog).not.toHaveTextContent('Ouvrir');
  expect(dialog).toHaveTextContent('répondra à tous les contacts');
  expect(dialog).toHaveTextContent('coût');
  expect(calls).toEqual([]);
  expect(within(dialog).queryByRole('button', { name: 'Ouvrir à tous' })).not.toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Réactiver pour tous' }));
  await waitFor(() => expect(calls).toEqual([{ url: '/api/bots/b1/status', method: 'PUT', body: { status: 'active' } }]));
});

test('« Annuler » dans la confirmation : fenêtre fermée, rien n\'est envoyé', async () => {
  const calls = stubFetch(() => json({}));
  const { onChanged } = renderPanel();
  await userEvent.click(screen.getByRole('button', { name: 'Ouvrir à tous' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Annuler' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(calls).toEqual([]);
  expect(onChanged).not.toHaveBeenCalled();
});

test('pas de confirmation pour entrer en accès limité (activer, revenir, réactiver)', async () => {
  for (const status of ['draft', 'active', 'paused'] as const) {
    const calls = stubFetch(() => json({}));
    renderPanel(botView({ status }));
    const label = { draft: 'Activer en accès limité', active: 'Revenir en accès limité', paused: 'Réactiver en accès limité' }[status];
    await userEvent.click(screen.getByRole('button', { name: label }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(calls).toEqual([{ url: '/api/bots/b1/status', method: 'PUT', body: { status: 'limited' } }]));
    cleanup();
  }
});

test('refus 409 du moteur : son message s\'affiche tel quel, la page est relue', async () => {
  stubFetch(() => engineError(409, 'CONFLICT', "Le compte WhatsApp de ce numéro n'est pas connecté."));
  const { onChanged } = renderPanel();
  await userEvent.click(screen.getByRole('button', { name: 'Ouvrir à tous' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Ouvrir à tous' }));
  expect(await screen.findByRole('alert')).toHaveTextContent("Le compte WhatsApp de ce numéro n'est pas connecté.");
  expect(onChanged).toHaveBeenCalledTimes(1);
});

test('organisation changée dans un autre onglet (409 ORG_CHANGED) : rien n\'est affiché', async () => {
  stubFetch(() => engineError(409, 'ORG_CHANGED', 'Organisation changée.'));
  const { onChanged } = renderPanel();
  await userEvent.click(screen.getByRole('button', { name: 'Désactiver' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Désactiver' }));
  await Promise.resolve();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(onChanged).not.toHaveBeenCalled();
});

test('panne réseau : message générique', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('réseau'); }));
  renderPanel();
  await userEvent.click(screen.getByRole('button', { name: 'Désactiver' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Désactiver' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Changement de statut impossible. Réessayez.');
});

test('membre non admin ou lecture seule : la pastille et le statut, aucun bouton', () => {
  renderPanel(botView(), false);
  expect(screen.getByText('Accès limité')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('compteur : N messages non servis et la date du dernier', () => {
  renderPanel(botView({ unserved: { count: 3, last_at: '2026-11-08T12:00:00.000Z' } }));
  expect(screen.getByText(/3 messages non servis, le dernier le .*nov\. 2026/)).toBeInTheDocument();
});

test('compteur : un seul message au singulier', () => {
  renderPanel(botView({ unserved: { count: 1, last_at: '2026-11-08T12:00:00.000Z' } }));
  expect(screen.getByText(/^1 message non servi, le dernier le /)).toBeInTheDocument();
});

test('compteur : aucun message non servi', () => {
  renderPanel();
  expect(screen.getByText('Aucun message non servi')).toBeInTheDocument();
});

// revue finale 2b-3 (contraste) : raisons des actions indisponibles et indice des messages non servis en text-muted
test('contraste : les raisons des actions indisponibles et l\'indice des messages non servis sont en text-muted', () => {
  renderPanel(botView({ status: 'draft', unserved: { count: 2, last_at: null } }));
  const reasons = screen.getByText(new RegExp(TRANSITION_MESSAGES.not_from_draft)).closest('ul')!;
  expect(isReadableMuted(reasons)).toBe(true);
  expect(isReadableMuted(screen.getByText(/ce nombre aide à décider/))).toBe(true);
});

// recette Q-10 : la liste vidée d'un agent IA en accès limité est permise, l'écran dit ce que cela veut dire
test('recette Q-10 : accès limité à liste vide, l\'encart le dit et propose ajouter, ouvrir à tous, désactiver', async () => {
  const calls = stubFetch(() => json({}));
  renderPanel(botView({ status: 'limited', allowlist: [] }));
  const notice = screen.getByText("Cet agent IA ne répond à personne : sa liste d'accès limité est vide.").closest('div')!;
  for (const name of ['Ajouter un numéro', 'Ouvrir à tous', 'Désactiver']) {
    expect(within(notice).getByRole('button', { name })).toBeEnabled();
  }
  // « Ouvrir à tous » et « Désactiver » reprennent les actions de statut et leurs confirmations
  await userEvent.click(within(notice).getByRole('button', { name: 'Désactiver' }));
  expect(calls).toEqual([]);
  expect(screen.getByRole('dialog')).toHaveTextContent('Désactiver Conseil Marais ?');
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Désactiver' }));
  await waitFor(() => expect(calls).toEqual([{ url: '/api/bots/b1/status', method: 'PUT', body: { status: 'paused' } }]));
});

// recette Q-10
test('recette Q-10 : « Ouvrir à tous » de l\'encart se confirme', async () => {
  const calls = stubFetch(() => json({}));
  renderPanel(botView({ status: 'limited', allowlist: [] }));
  const notice = screen.getByText(/ne répond à personne/).closest('div')!;
  await userEvent.click(within(notice).getByRole('button', { name: 'Ouvrir à tous' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Ouvrir Conseil Marais à tous ?');
  expect(calls).toEqual([]);
});

// recette Q-10
test('recette Q-10 : pas d\'encart quand la liste a une entrée, ni hors accès limité', () => {
  renderPanel(botView({ status: 'limited' }));
  expect(screen.queryByText(/ne répond à personne/)).not.toBeInTheDocument();
  cleanup();
  renderPanel(botView({ status: 'paused', allowlist: [] }));
  expect(screen.queryByText(/sa liste d'accès limité est vide/)).not.toBeInTheDocument();
});

// recette Q-10 : un membre voit le constat, pas les boutons
test('recette Q-10 : lecture seule, l\'encart dit le constat sans bouton', () => {
  renderPanel(botView({ status: 'limited', allowlist: [] }), false);
  expect(screen.getByText("Cet agent IA ne répond à personne : sa liste d'accès limité est vide.")).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

// point d'attention 3 du plan : liste vide, Désactiver, puis réactiver en accès limité est refusé avec la suite à donner
test('point d\'attention 3 : liste vide, désactivé, « Réactiver en accès limité » refusé avec « Ajouter un numéro »', () => {
  renderPanel(botView({ status: 'paused', allowlist: [] }));
  const resume = screen.getByRole('button', { name: 'Réactiver en accès limité' });
  expect(resume).toBeDisabled();
  const line = screen.getByText(new RegExp(TRANSITION_MESSAGES.empty_allowlist)).closest('li')!;
  expect(line).toHaveTextContent(`Réactiver en accès limité : ${TRANSITION_MESSAGES.empty_allowlist}`);
  expect(within(line).getByRole('button', { name: 'Ajouter un numéro' })).toBeInTheDocument();
});

// point d'attention 3 : le moteur reste juge, son refus `transition.empty_allowlist` s'affiche avec « Ajouter un numéro »
test('point d\'attention 3 : refus du moteur transition.empty_allowlist affiché tel quel avec « Ajouter un numéro »', async () => {
  stubFetch(() => engineError(409, 'CONFLICT', TRANSITION_MESSAGES.empty_allowlist, undefined, 'transition.empty_allowlist'));
  // L'écran croit la liste remplie (lecture périmée) : le moteur, lui, la voit vide.
  const { onChanged } = renderPanel(botView({ status: 'paused' }));
  await userEvent.click(screen.getByRole('button', { name: 'Réactiver en accès limité' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(TRANSITION_MESSAGES.empty_allowlist);
  expect(within(alert).getByRole('button', { name: 'Ajouter un numéro' })).toBeInTheDocument();
  expect(onChanged).toHaveBeenCalledTimes(1);
});

// recette Q-1 : un seul bouton de chaque nom, l'encart porte « Ouvrir à tous » et « Désactiver », la rangée ne les répète pas
test('recette Q-1 : accès limité à liste vide, exactement un bouton « Ouvrir à tous » et un « Désactiver », dans l\'encart', () => {
  renderPanel(botView({ status: 'limited', allowlist: [] }));
  for (const name of ['Ajouter un numéro', 'Ouvrir à tous', 'Désactiver']) {
    expect(screen.getAllByRole('button', { name })).toHaveLength(1);
  }
  const notice = screen.getByText(/ne répond à personne/).parentElement!;
  expect(within(notice).getByRole('button', { name: 'Ouvrir à tous' })).toBeInTheDocument();
  expect(within(notice).getByRole('button', { name: 'Désactiver' })).toBeInTheDocument();
  // la région vivante est la phrase seule, pas le wrapper avec ses boutons
  const live = screen.getByRole('status');
  expect(live).toHaveTextContent("Cet agent IA ne répond à personne : sa liste d'accès limité est vide.");
  expect(within(live).queryByRole('button')).not.toBeInTheDocument();
});

test('recette Q-1 : liste non vide ou hors accès limité, la rangée garde ses boutons', () => {
  renderPanel(botView({ status: 'limited' }));
  expect(screen.getAllByRole('button', { name: 'Désactiver' })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Ouvrir à tous' })).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Ajouter un numéro' })).not.toBeInTheDocument();
});
