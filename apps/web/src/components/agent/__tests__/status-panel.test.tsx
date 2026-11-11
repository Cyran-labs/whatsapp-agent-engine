import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach, describe } from 'vitest';
import { BOT_PAUSE_REASONS, TRANSITION_MESSAGES, decideResponding } from '@wabagent/contracts';
import fr from '../../../../messages/fr.json';
import en from '../../../../messages/en.json';
import { StatusPanel } from '../status-panel';
import { NEUTRAL_MARK } from '@/components/agents/status-style';
import { botNumber, botView as fixtureBot } from './fixtures';
import type { BotView } from '@/lib/agent-types';
import { engineError, isReadableMuted, json, renderIntl, stubFetch } from '@/components/connections/__tests__/helpers';

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

/** Agent IA tel que le moteur le renvoie : la mention `not_responding` calculée par `decideResponding`, comme lui. */
function botView(over: Partial<BotView> = {}): BotView {
  const bot = fixtureBot(over);
  const n = bot.whatsapp_number;
  const not_responding = decideResponding({
    status: bot.status,
    number: n && { present: n.provider_state === 'present', account_state: n.account.state },
    organizationActive: true,
    allowlistCount: bot.allowlist.length,
  });
  return { ...bot, not_responding };
}

function renderPanel(bot = botView(), canEdit = true) {
  const onChanged = vi.fn();
  renderIntl(<StatusPanel bot={bot} canEdit={canEdit} onChanged={onChanged} />);
  return { onChanged };
}

test('admin, accès limité : ouvrir à tous et désactiver', () => {
  renderPanel();
  expect(screen.getByText('Preview')).toBeInTheDocument();
  for (const name of ['Passer Online', 'Passer Offline']) {
    expect(screen.getByRole('button', { name })).toBeEnabled();
  }
  expect(screen.queryByRole('button', { name: /Limiter à la Whitelist/ })).not.toBeInTheDocument();
});

// recette Q-1 : les statuts disent l'activation, jamais « brouillon » ni « pause » dans une action
test('recette Q-1 : aucune action de statut ne parle de brouillon ou de pause, quel que soit le statut', () => {
  for (const status of ['draft', 'limited', 'active', 'paused'] as const) {
    renderPanel(botView({ status, whatsapp_number: botNumber({ is_test: true }) }));
    const row = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    for (const label of row) expect(label).not.toMatch(/brouillon|pause|draft/i);
    cleanup();
  }
});

// recette Q-1
test('recette Q-1 : désactivé, deux actions de réactivation et le mot Désactivé sur la pastille', () => {
  renderPanel(botView({ status: 'paused' }));
  expect(screen.getByText('Offline')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Repasser en Preview' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Repasser Online' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Passer Offline' })).not.toBeInTheDocument();
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
  expect(screen.getByRole('button', { name: 'Passer en Preview' })).toBeEnabled();
  const open = screen.getByRole('button', { name: 'Passer Online' });
  expect(open).toBeDisabled();
  const reason = screen.getByText(new RegExp(TRANSITION_MESSAGES.not_from_draft));
  expect(reason).toBeVisible();
  // La ligne nomme l'action et dit pourquoi.
  expect(reason).toHaveTextContent(`Passer Online : ${TRANSITION_MESSAGES.not_from_draft}`);
  expect(open).toHaveAccessibleDescription(`Passer Online : ${TRANSITION_MESSAGES.not_from_draft}`);
});

test('les raisons sont sous la rangée de boutons : une raison ne décale pas les boutons', () => {
  renderPanel(botView({ status: 'active', whatsapp_number: botNumber({ account_state: 'error' }) }));
  const row = screen.getByRole('button', { name: 'Passer Offline' }).closest('ul')!;
  const reason = screen.getByText(new RegExp(TRANSITION_MESSAGES.account_not_connected));
  expect(row).not.toContainElement(reason);
  expect(within(row).getAllByRole('button')).toHaveLength(2);
  expect(row.compareDocumentPosition(reason) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // Une ligne par action indisponible, qui la nomme.
  expect(reason).toHaveTextContent(`Limiter à la Whitelist : ${TRANSITION_MESSAGES.account_not_connected}`);
});

test('brouillon sur un numéro de test : « Ouvrir à tous » permis', () => {
  renderPanel(botView({ status: 'draft', whatsapp_number: botNumber({ is_test: true }) }));
  expect(screen.getByRole('button', { name: 'Passer Online' })).toBeEnabled();
});

test('liste vide : entrer en accès limité est indisponible avec la phrase du moteur', () => {
  renderPanel(botView({ status: 'paused', allowlist: [] }));
  const resume = screen.getByRole('button', { name: 'Repasser en Preview' });
  expect(resume).toBeDisabled();
  expect(resume).toHaveAccessibleDescription(`Repasser en Preview : ${TRANSITION_MESSAGES.empty_allowlist}`);
});

// décision François A11
test('actif : « Limiter l\'accès »', () => {
  renderPanel(botView({ status: 'active' }));
  expect(screen.getByRole('button', { name: 'Limiter à la Whitelist' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: /Revenir/ })).not.toBeInTheDocument();
});

// décision François A11 : fenêtre de confirmation au nom de l'action, comme « Ouvrir à tous » et « Désactiver »
test('« Limiter l\'accès » : confirmation qui dit que seuls les numéros de la liste recevront une réponse ; rien n\'est envoyé avant', async () => {
  const calls = stubFetch(() => json({}));
  const { onChanged } = renderPanel(botView({ status: 'active' }));
  await userEvent.click(screen.getByRole('button', { name: 'Limiter à la Whitelist' }));
  const dialog = screen.getByRole('dialog', { name: "Limiter Conseil Marais à la Whitelist ?" });
  expect(dialog).toHaveTextContent("Conseil Marais passera en Preview et ne répondra plus qu'aux numéros de sa Whitelist");
  expect(calls).toEqual([]);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Limiter à la Whitelist' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(calls).toEqual([{ url: '/api/bots/b1/status', method: 'PUT', body: { status: 'limited' } }]);
});

// prototype 9 : même raison pour les deux actions, une seule ligne qui décrit chacune
test('compte du numéro en erreur : limited et active indisponibles, raison affichée une fois', () => {
  renderPanel(botView({ status: 'paused', whatsapp_number: botNumber({ account_state: 'error' }) }));
  for (const name of ['Repasser en Preview', 'Repasser Online']) {
    const button = screen.getByRole('button', { name });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(TRANSITION_MESSAGES.account_not_connected);
  }
  expect(screen.getAllByText(new RegExp(TRANSITION_MESSAGES.account_not_connected))).toHaveLength(1);
});

test('pause automatique pour numéro retiré : le motif est dit', () => {
  renderPanel(botView({ status: 'paused', status_reason: 'number_removed', whatsapp_number: botNumber({ present: false }) }));
  expect(screen.getByText('Numéro retiré')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Repasser en Preview' })).toBeDisabled();
});

// décision François A9
test('pause automatique pour numéro débranché : le motif est dit, la réactivation attend un numéro', () => {
  renderPanel(botView({ status: 'paused', status_reason: 'number_unassigned', whatsapp_number: null }));
  expect(screen.getByText('Numéro débranché')).toBeInTheDocument();
  expect(screen.queryByText('Numéro retiré')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Repasser Online' })).toBeDisabled();
});

// décision François A9 : chaque motif du moteur a son texte en français et en anglais
test('chaque motif de pause des contrats a sa ligne dans les deux langues, jamais son code', () => {
  for (const reason of [...BOT_PAUSE_REASONS, 'manual', 'unknown'] as const) {
    expect(fr.agentStatus.pauseReasons[reason]).toBeTruthy();
    expect(en.agentStatus.pauseReasons[reason]).toBeTruthy();
    expect(fr.agentStatus.pauseReasons[reason]).not.toContain('_');
  }
});

// spec 6.1 : Offline toujours suivi de son motif, arrêt manuel compris
test('Offline sans motif (arrêt manuel) : « Arrêté par un administrateur » à côté de la pastille', () => {
  renderPanel(botView({ status: 'paused', status_reason: null }));
  expect(screen.getByText('Offline').parentElement).toHaveTextContent('Arrêté par un administrateur');
});

// décision François A9 : un motif inconnu du web n'est jamais affiché tel quel
test('motif de pause inconnu : « Arrêté », jamais le texte brut', () => {
  renderPanel(botView({ status: 'paused', status_reason: 'motif_futur' }));
  expect(screen.queryByText(/motif_futur/)).not.toBeInTheDocument();
  expect(screen.getByText('Arrêté')).toBeInTheDocument();
});

test('« Désactiver » (confirmé) envoie PUT /status avec { status: "paused" } puis relit la page', async () => {
  const calls = stubFetch(() => json({}));
  const { onChanged } = renderPanel();
  await userEvent.click(screen.getByRole('button', { name: 'Passer Offline' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Passer Offline' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(calls).toEqual([{ url: '/api/bots/b1/status', method: 'PUT', body: { status: 'paused' } }]);
});

// revue finale 2b-3 m-7 : « Ouvrir à tous » et « Désactiver » se confirment
test('« Ouvrir à tous » : confirmation qui dit que l\'agent IA répondra à tous les contacts, avec le coût ; rien n\'est envoyé avant', async () => {
  const calls = stubFetch(() => json({}));
  const { onChanged } = renderPanel();
  await userEvent.click(screen.getByRole('button', { name: 'Passer Online' }));
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveTextContent('Passer Conseil Marais Online ?');
  expect(dialog).toHaveTextContent('répondra à tous les contacts');
  expect(dialog).toHaveTextContent('coût');
  expect(calls).toEqual([]);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Passer Online' }));
  await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  expect(calls).toEqual([{ url: '/api/bots/b1/status', method: 'PUT', body: { status: 'active' } }]);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('« Désactiver » depuis l\'accès limité ou ouvert à tous : confirmation qui dit que l\'agent IA cesse de répondre', async () => {
  for (const status of ['limited', 'active'] as const) {
    const calls = stubFetch(() => json({}));
    const { onChanged } = renderPanel(botView({ status }));
    await userEvent.click(screen.getByRole('button', { name: 'Passer Offline' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Passer Conseil Marais Offline ?');
    expect(dialog).toHaveTextContent('cessera de répondre');
    expect(dialog).toHaveTextContent('vous pourrez le remettre en Preview ou Online');
    expect(calls).toEqual([]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Passer Offline' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([{ url: '/api/bots/b1/status', method: 'PUT', body: { status: 'paused' } }]);
    cleanup();
  }
});

// recette Q-1 : la fenêtre porte le mot de l'action choisie, pas celui d'une autre
test('« Réactiver pour tous » se confirme dans sa propre fenêtre et envoie active', async () => {
  const calls = stubFetch(() => json({}));
  renderPanel(botView({ status: 'paused' }));
  await userEvent.click(screen.getByRole('button', { name: 'Repasser Online' }));
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveTextContent('Repasser Conseil Marais Online ?');
  expect(dialog).not.toHaveTextContent('Passer Conseil');
  expect(dialog).toHaveTextContent('répondra à tous les contacts');
  expect(dialog).toHaveTextContent('coût');
  expect(calls).toEqual([]);
  expect(within(dialog).queryByRole('button', { name: 'Passer Online' })).not.toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Repasser Online' }));
  await waitFor(() => expect(calls).toEqual([{ url: '/api/bots/b1/status', method: 'PUT', body: { status: 'active' } }]));
});

test('« Annuler » dans la confirmation : fenêtre fermée, rien n\'est envoyé', async () => {
  const calls = stubFetch(() => json({}));
  const { onChanged } = renderPanel();
  await userEvent.click(screen.getByRole('button', { name: 'Passer Online' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Annuler' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(calls).toEqual([]);
  expect(onChanged).not.toHaveBeenCalled();
});

test('pas de confirmation pour activer ou réactiver en accès limité', async () => {
  for (const status of ['draft', 'paused'] as const) {
    const calls = stubFetch(() => json({}));
    renderPanel(botView({ status }));
    const label = { draft: 'Passer en Preview', paused: 'Repasser en Preview' }[status];
    await userEvent.click(screen.getByRole('button', { name: label }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(calls).toEqual([{ url: '/api/bots/b1/status', method: 'PUT', body: { status: 'limited' } }]));
    cleanup();
  }
});

test('refus 409 du moteur : son message s\'affiche tel quel, la page est relue', async () => {
  stubFetch(() => engineError(409, 'CONFLICT', "Le compte WhatsApp de ce numéro n'est pas connecté."));
  const { onChanged } = renderPanel();
  await userEvent.click(screen.getByRole('button', { name: 'Passer Online' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Passer Online' }));
  expect(await screen.findByRole('alert')).toHaveTextContent("Le compte WhatsApp de ce numéro n'est pas connecté.");
  expect(onChanged).toHaveBeenCalledTimes(1);
});

test('organisation changée dans un autre onglet (409 ORG_CHANGED) : rien n\'est affiché', async () => {
  stubFetch(() => engineError(409, 'ORG_CHANGED', 'Organisation changée.'));
  const { onChanged } = renderPanel();
  await userEvent.click(screen.getByRole('button', { name: 'Passer Offline' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Passer Offline' }));
  await Promise.resolve();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(onChanged).not.toHaveBeenCalled();
});

test('panne réseau : message générique', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('réseau'); }));
  renderPanel();
  await userEvent.click(screen.getByRole('button', { name: 'Passer Offline' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Passer Offline' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Changement de statut impossible. Réessayez.');
});

test('membre non admin ou lecture seule : la pastille et le statut, aucun bouton', () => {
  renderPanel(botView(), false);
  expect(screen.getByText('Preview')).toBeInTheDocument();
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

// recette 10 nov. 2026 : « ce nombre aide à décider d'ouvrir plus tôt » restait affiché pour un agent IA déjà ouvert à tous
test('ouvert à tous sans message non servi : aucun bloc', () => {
  renderPanel(botView({ status: 'active', unserved: { count: 0, last_at: null } }));
  expect(screen.queryByText(/non servi/)).not.toBeInTheDocument();
});

// revue de la tâche 20, décision du contrôleur : le moteur compte aussi des messages non servis pour un agent IA ouvert à tous
// (compte en erreur ou non connecté, organisation suspendue) ; ce compteur réel reste visible, sans l'indice « ouvrir plus tôt ».
// Revue de la tâche 20, tour 2 : le compteur est cumulatif, l'indice le dit et ne l'attribue pas à une cause unique
test('ouvert à tous avec des messages non servis : compteur affiché, indice adapté, jamais « ouvrir plus tôt »', () => {
  renderPanel(botView({ status: 'active', unserved: { count: 1, last_at: '2026-11-08T12:00:00.000Z' }, whatsapp_number: botNumber({ account_state: 'error' }) }));
  expect(screen.getByText(/^1 message non servi, le dernier le /)).toBeInTheDocument();
  expect(screen.getByText("Ce nombre compte tous les messages non servis depuis la création de cet agent IA, quel que soit son statut à ce moment-là. Aucune réponse n'a été envoyée et le contenu n'est pas conservé. S'il augmente alors que l'agent IA est Online, vérifiez son compte WhatsApp, son numéro et que l'organisation n'est pas suspendue.")).toBeInTheDocument();
  expect(screen.queryByText(/plus tôt/)).not.toBeInTheDocument();
  expect(screen.getAllByText(/^Ce nombre/)).toHaveLength(1);
});

// recette 10 nov. 2026 : un texte adapté à chaque cas où des messages ne sont pas servis
test.each([
  ['limited', /ce nombre aide à décider de passer Online plus tôt\./],
  ['draft', /ce nombre aide à décider d'activer cet agent IA\./],
  ['paused', /ce nombre aide à décider de le remettre en service\./],
] as const)('%s : le compteur et l\'indice adapté au statut', (status, hint) => {
  renderPanel(botView({ status, unserved: { count: 2, last_at: '2026-11-08T12:00:00.000Z' } }));
  expect(screen.getByText(/2 messages non servis/)).toBeInTheDocument();
  expect(screen.getByText(hint)).toBeInTheDocument();
  expect(screen.getAllByText(/ce nombre aide/)).toHaveLength(1);
});

test('en anglais : indice adapté au statut, y compris pour un agent IA ouvert à tous, rien sans message non servi', () => {
  renderIntl(<StatusPanel bot={botView({ status: 'draft', unserved: { count: 2, last_at: null } })} canEdit onChanged={vi.fn()} />, 'en');
  expect(screen.getByText(/this count helps you decide to activate this AI agent/)).toBeInTheDocument();
  cleanup();
  renderIntl(<StatusPanel bot={botView({ status: 'active', unserved: { count: 2, last_at: null } })} canEdit onChanged={vi.fn()} />, 'en');
  expect(screen.getByText("This count includes all unserved messages since this AI agent was created, whatever its status at the time. No reply was sent and the content is not kept. If it goes up while the AI agent is Online, check its WhatsApp account, its number and that the organization is not suspended.")).toBeInTheDocument();
  cleanup();
  renderIntl(<StatusPanel bot={botView({ status: 'active', unserved: { count: 0, last_at: null } })} canEdit onChanged={vi.fn()} />, 'en');
  expect(screen.queryByText(/unserved/)).not.toBeInTheDocument();
});


const ADD = 'Ajouter un numéro à la Whitelist';
const CONTACT_ADMIN = 'Prévenez un administrateur de votre organisation.';
const INVITATION = 'Ajoutez un numéro à la Whitelist pour que cet agent IA réponde.';
/** Encadré « Ne répond pas » (rouge, neutre pour la Whitelist vide) : le bloc qui porte la mention écrite (spec 10.3). */
const notRespondingBox = (mention: string) => screen.getByText(mention).closest('[data-not-responding]') as HTMLElement;

test('accès limité avec une liste : la phrase de statut reste affichée, aucun encadré', () => {
  renderPanel(botView({ status: 'limited', allowlist: ['+33611111111'] }));
  expect(screen.getByText("Répond seulement aux numéros de la Whitelist.")).toBeInTheDocument();
  expect(screen.queryByText(/^Ne répond pas/)).not.toBeInTheDocument();
});

// spec 10.3 : encadré rouge (jeton danger) avec la mention écrite, ce qui se passe et l'action utile, admin et conseiller
describe('encadré « Ne répond pas », pour chacun des quatre motifs visibles', () => {
  test('aucun numéro (Preview) : admin, « Brancher un numéro » ouvre la fenêtre de branchement', async () => {
    stubFetch(() => json([]));
    const bot = botView({ status: 'limited', whatsapp_number: null });
    expect(bot.not_responding).toBe('no_number');
    renderPanel(bot);
    const box = notRespondingBox('Ne répond pas : aucun numéro');
    expect(box.className).toContain('bg-danger-soft');
    expect(box).toHaveTextContent("Aucun numéro WhatsApp n'est branché : aucun contact ne peut lui écrire.");
    await userEvent.click(within(box).getByRole('button', { name: 'Brancher un numéro' }));
    expect(await screen.findByRole('dialog', { name: 'Brancher un numéro' })).toBeInTheDocument();
  });

  test('numéro retiré (Online) : admin, « Changer de numéro » ouvre la fenêtre de changement', async () => {
    stubFetch(() => json([]));
    const bot = botView({ status: 'active', whatsapp_number: botNumber({ present: false }) });
    expect(bot.not_responding).toBe('number_removed');
    renderPanel(bot);
    const box = notRespondingBox('Ne répond pas : numéro retiré');
    expect(box).toHaveTextContent('Son numéro a été retiré chez le fournisseur');
    await userEvent.click(within(box).getByRole('button', { name: 'Changer de numéro' }));
    expect(await screen.findByRole('dialog', { name: 'Changer de numéro' })).toBeInTheDocument();
  });

  // choix P-2 : la fenêtre « Remplacer les identifiants » vit dans Connexions, l'encadré y mène
  test('compte en erreur (Online) : admin, lien « Ouvrir Connexions ↗ » vers Connexions', () => {
    const bot = botView({ status: 'active', whatsapp_number: botNumber({ account_state: 'error' }) });
    expect(bot.not_responding).toBe('account_not_connected');
    renderPanel(bot);
    const box = notRespondingBox('Ne répond pas : compte WhatsApp en erreur');
    expect(box).toHaveTextContent('Le compte WhatsApp de son numéro est en erreur');
    expect(within(box).getByRole('link', { name: 'Ouvrir Connexions ↗' })).toHaveAttribute('href', '/organisation/connexions');
  });

  test('compte déconnecté : « non connecté », lu de la mention du moteur', () => {
    renderPanel(botView({ status: 'active', whatsapp_number: botNumber({ account_state: 'disconnected' }) }));
    const box = notRespondingBox('Ne répond pas : compte WhatsApp non connecté');
    expect(box).toHaveTextContent("Le compte WhatsApp de son numéro n'est pas connecté : aucun message reçu n'est servi.");
  });

  // recette 3.5, spec 7.1 : la Whitelist vide est un état, pas une erreur : encadré neutre, invitation et lien d'ajout
  test('Whitelist vide (Preview) : admin, encadré neutre, invitation, « Ajouter un numéro à la Whitelist » seule action', () => {
    const bot = botView({ status: 'limited', allowlist: [] });
    expect(bot.not_responding).toBe('empty_allowlist');
    renderPanel(bot);
    const box = notRespondingBox('Whitelist vide');
    expect(box.className).not.toMatch(/danger/);
    expect(box.innerHTML).not.toMatch(/danger/);
    expect(box.className).toContain('border-border-strong');
    expect(box.className).toContain('bg-surface');
    expect(box).toHaveTextContent(INVITATION);
    expect(box).not.toHaveTextContent('Ne répond pas');
    expect(screen.getByRole('status')).toHaveTextContent(/^Whitelist vide$/);
    expect(within(box).getAllByRole('button').map((b) => b.textContent)).toEqual([ADD]);
  });

  // recette 3.4 : les autres motifs gardent l'encadré rouge
  test('motif autre que la Whitelist vide : encadré rouge (danger-soft)', () => {
    renderPanel(botView({ status: 'active', whatsapp_number: botNumber({ account_state: 'error' }) }));
    expect(notRespondingBox('Ne répond pas : compte WhatsApp en erreur').className).toContain('bg-danger-soft');
  });

  test.each([
    ['no_number', botView({ status: 'limited', whatsapp_number: null }), 'Ne répond pas : aucun numéro'],
    ['number_removed', botView({ status: 'active', whatsapp_number: botNumber({ present: false }) }), 'Ne répond pas : numéro retiré'],
    ['account_not_connected', botView({ status: 'active', whatsapp_number: botNumber({ account_state: 'error' }) }), 'Ne répond pas : compte WhatsApp en erreur'],
    ['empty_allowlist', botView({ status: 'limited', allowlist: [] }), 'Whitelist vide'],
  ] as const)('%s, conseiller : la mention, ce qui se passe et « Prévenez un administrateur », ni bouton ni lien', (_reason, bot, mention) => {
    renderPanel(bot, false);
    const box = notRespondingBox(mention);
    expect(box).toHaveTextContent(CONTACT_ADMIN);
    expect(within(box).queryByRole('button')).not.toBeInTheDocument();
    expect(within(box).queryByRole('link')).not.toBeInTheDocument();
  });
});

// registre (relecture tâche 7) : la description « Répond seulement aux numéros de la Whitelist. » était affichée pour un
// agent IA Preview sans numéro ou au numéro retiré ; elle dit maintenant ce qui se passe
test.each([
  [botView({ status: 'limited', whatsapp_number: null }), "Aucun numéro WhatsApp n'est branché : aucun contact ne peut lui écrire."],
  [botView({ status: 'limited', whatsapp_number: botNumber({ present: false }) }), 'Son numéro a été retiré chez le fournisseur : les messages envoyés à ce numéro ne lui parviennent plus.'],
  [botView({ status: 'active', whatsapp_number: null }), "Aucun numéro WhatsApp n'est branché : aucun contact ne peut lui écrire."],
  [botView({ status: 'active', whatsapp_number: botNumber({ present: false }) }), 'Son numéro a été retiré chez le fournisseur : les messages envoyés à ce numéro ne lui parviennent plus.'],
])('description vraie sans numéro ou au numéro retiré (%#), jamais la phrase du statut', (bot, sentence) => {
  renderPanel(bot);
  expect(screen.getByText(sentence)).toBeInTheDocument();
  expect(screen.queryByText('Répond seulement aux numéros de la Whitelist.')).not.toBeInTheDocument();
  expect(screen.queryByText('Répond à tous les contacts qui lui écrivent.')).not.toBeInTheDocument();
});

// décision du contrôleur (relecture tâche 7, tour 1) : l'encart « Whitelist vide » et son action d'ajout restent
// affichés dès qu'un agent IA en Preview a une Whitelist vide, même quand la mention du moteur donne une autre première
// cause (spec 7.1 : le compte passe avant la Whitelist)
test('Preview à Whitelist vide et compte en erreur : encadré du compte, et encart « Whitelist vide » avec son action', () => {
  const bot = botView({ status: 'limited', allowlist: [], whatsapp_number: botNumber({ account_state: 'error' }) });
  expect(bot.not_responding).toBe('account_not_connected');
  renderPanel(bot);
  expect(notRespondingBox('Ne répond pas : compte WhatsApp en erreur')).toBeInTheDocument();
  const notice = screen.getByText('Cet agent IA ne répond à personne : sa Whitelist est vide.').closest('div')!;
  expect(within(notice).getByRole('button', { name: ADD })).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: ADD })).toHaveLength(1);
  // recette 3.5 (décision du PO) : la Whitelist vide reste un état neutre quand une autre cause passe en premier
  expect(notice).toHaveAttribute('data-empty-list-notice');
  expect(notice.className).toContain(NEUTRAL_MARK);
  expect(notice.outerHTML).not.toMatch(/warning|danger/);
  expect(screen.queryByText('Répond seulement aux numéros de la Whitelist.')).not.toBeInTheDocument();
});

// relecture tâche 9, m-5 : Preview à Whitelist vide sans mention lue du moteur (nulle ou inconnue des contrats) : l'encart
// neutre dit tout de même qu'il ne répond à personne, avec l'action d'ajout ; aucun encadré rouge
test.each([null, 'motif_futur'])('Preview à Whitelist vide, mention %s : encart « Whitelist vide » avec son action, sans encadré', (raw) => {
  renderPanel({ ...fixtureBot({ status: 'limited', allowlist: [] }), not_responding: raw as BotView['not_responding'] });
  const notice = screen.getByText('Cet agent IA ne répond à personne : sa Whitelist est vide.').closest('div')!;
  expect(within(notice).getByRole('button', { name: ADD })).toBeInTheDocument();
  // recette 3.5 (décision du PO) : ton neutre, jamais ambre
  expect(notice.className).toContain(NEUTRAL_MARK);
  expect(notice.outerHTML).not.toMatch(/warning|danger/);
  expect(screen.queryByText(/^Ne répond pas/)).not.toBeInTheDocument();
  expect(screen.queryByText('Répond seulement aux numéros de la Whitelist.')).toBeInTheDocument();
});

// relecture tâche 9, m-7 : une seule région vivante dans l'encart, la mention de l'encadré
test('compte en erreur et Whitelist vide : une seule région role="status", la mention', () => {
  renderPanel(botView({ status: 'limited', allowlist: [], whatsapp_number: botNumber({ account_state: 'error' }) }));
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status')).toHaveTextContent('Ne répond pas : compte WhatsApp en erreur');
});

// relecture tâche 7, M-3 : la description suit la mention du moteur, jamais l'état du compte lu à part
test('description lue de not_responding : compte en erreur sans mention, la description d\'Online reste', () => {
  renderPanel(fixtureBot({ status: 'active', not_responding: null, whatsapp_number: botNumber({ account_state: 'error' }) }));
  expect(screen.getByText('Répond à tous les contacts qui lui écrivent.')).toBeInTheDocument();
  expect(screen.queryByText(/^Ne répond pas/)).not.toBeInTheDocument();
});

test('description lue de not_responding : mention du compte sur un compte lu connecté, l\'encadré du compte est affiché', () => {
  renderPanel(fixtureBot({ status: 'active', not_responding: 'account_not_connected', whatsapp_number: botNumber({ account_state: 'connected' }) }));
  expect(notRespondingBox('Ne répond pas : compte WhatsApp en erreur')).toHaveTextContent('Le compte WhatsApp de son numéro est en erreur');
  expect(screen.queryByText('Répond à tous les contacts qui lui écrivent.')).not.toBeInTheDocument();
});

// point d'attention 4 : une mention reçue avec un statut qui ne sert pas n'est jamais affichée
test('mention reçue pour un agent IA Draft ou Offline : aucun encadré', () => {
  renderPanel(fixtureBot({ status: 'draft', not_responding: 'no_number', whatsapp_number: null }));
  expect(screen.queryByText(/^Ne répond pas/)).not.toBeInTheDocument();
  cleanup();
  renderPanel(fixtureBot({ status: 'paused', not_responding: 'no_number', whatsapp_number: null }));
  expect(screen.queryByText(/^Ne répond pas/)).not.toBeInTheDocument();
});

// revue finale 2b-3 (contraste) : raisons des actions indisponibles et indice des messages non servis en text-muted
test('contraste : les raisons des actions indisponibles et l\'indice des messages non servis sont en text-muted', () => {
  renderPanel(botView({ status: 'draft', unserved: { count: 2, last_at: null } }));
  const reasons = screen.getByText(new RegExp(TRANSITION_MESSAGES.not_from_draft)).closest('ul')!;
  expect(isReadableMuted(reasons)).toBe(true);
  expect(isReadableMuted(screen.getByText(/ce nombre aide à décider/))).toBe(true);
});

// prototype 9 : Draft sans numéro, les deux actions grisées ont la même raison, une seule ligne la dit
test('Draft sans numéro : une seule ligne de raison sous les deux boutons grisés, qui la décrit pour chacun', () => {
  renderPanel(botView({ status: 'draft', whatsapp_number: null }));
  const reason = TRANSITION_MESSAGES.no_number;
  expect(screen.getAllByText(new RegExp(reason))).toHaveLength(1);
  for (const name of ['Passer en Preview', 'Passer Online']) {
    const button = screen.getByRole('button', { name });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(reason);
  }
});

test('raisons différentes : une ligne par action, qui la nomme', () => {
  renderPanel(botView({ status: 'draft' }));
  expect(screen.getByText(new RegExp(TRANSITION_MESSAGES.not_from_draft))).toHaveTextContent(`Passer Online : ${TRANSITION_MESSAGES.not_from_draft}`);
});

// recette Q-10 et spec 10.3 : la Whitelist vidée d'un agent IA en Preview est permise ; l'encadré propose d'ajouter un
// numéro, « Passer Online » et « Passer Offline » restent dans la rangée des actions, avec leur confirmation
test('Whitelist vide : « Passer Online » absent de l\'encadré, présent dans la rangée, et il se confirme', async () => {
  const calls = stubFetch(() => json({}));
  renderPanel(botView({ status: 'limited', allowlist: [] }));
  const box = notRespondingBox('Whitelist vide');
  expect(within(box).queryByRole('button', { name: 'Passer Online' })).not.toBeInTheDocument();
  expect(within(box).queryByRole('button', { name: 'Passer Offline' })).not.toBeInTheDocument();
  const row = screen.getByRole('button', { name: 'Passer Online' }).closest('ul')!;
  expect(box).not.toContainElement(row);
  expect(within(row).getByRole('button', { name: 'Passer Offline' })).toBeEnabled();
  await userEvent.click(within(row).getByRole('button', { name: 'Passer Online' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Passer Conseil Marais Online ?');
  expect(calls).toEqual([]);
});

// recette Q-1 : un seul bouton de chaque nom
test('recette Q-1 : Whitelist vide, exactement un bouton de chaque action', () => {
  renderPanel(botView({ status: 'limited', allowlist: [] }));
  for (const name of [ADD, 'Passer Online', 'Passer Offline']) {
    expect(screen.getAllByRole('button', { name })).toHaveLength(1);
  }
  // la région vivante est la mention seule, pas l'encadré avec son action
  const live = screen.getByRole('status');
  expect(live).toHaveTextContent(/^Whitelist vide$/);
  expect(within(live).queryByRole('button')).not.toBeInTheDocument();
});

test('recette Q-10 : pas d\'encadré quand la Whitelist a une entrée, ni hors Preview', () => {
  renderPanel(botView({ status: 'limited' }));
  expect(screen.queryByText(/ne répond à personne/)).not.toBeInTheDocument();
  cleanup();
  renderPanel(botView({ status: 'paused', allowlist: [] }));
  expect(screen.queryByText(/Whitelist vide/)).not.toBeInTheDocument();
});

// point d'attention 3 du plan : Whitelist vide, Offline, puis repasser en Preview est refusé avec la suite à donner
test('point d\'attention 3 : Whitelist vide, Offline, « Repasser en Preview » refusé avec « Ajouter un numéro à la Whitelist »', () => {
  renderPanel(botView({ status: 'paused', allowlist: [] }));
  const resume = screen.getByRole('button', { name: 'Repasser en Preview' });
  expect(resume).toBeDisabled();
  const line = screen.getByText(new RegExp(TRANSITION_MESSAGES.empty_allowlist)).closest('li')!;
  expect(line).toHaveTextContent(`Repasser en Preview : ${TRANSITION_MESSAGES.empty_allowlist}`);
  expect(within(line).getByRole('button', { name: ADD })).toBeInTheDocument();
});

// point d'attention 3 : le moteur reste juge, son refus `transition.empty_allowlist` s'affiche avec l'action d'ajout
test('point d\'attention 3 : refus du moteur transition.empty_allowlist affiché tel quel avec « Ajouter un numéro à la Whitelist »', async () => {
  stubFetch(() => engineError(409, 'CONFLICT', TRANSITION_MESSAGES.empty_allowlist, undefined, 'transition.empty_allowlist'));
  // L'écran croit la liste remplie (lecture périmée) : le moteur, lui, la voit vide.
  const { onChanged } = renderPanel(botView({ status: 'paused' }));
  await userEvent.click(screen.getByRole('button', { name: 'Repasser en Preview' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(TRANSITION_MESSAGES.empty_allowlist);
  expect(within(alert).getByRole('button', { name: ADD })).toBeInTheDocument();
  expect(onChanged).toHaveBeenCalledTimes(1);
});

test('recette Q-1 : Whitelist remplie ou hors Preview, la rangée garde ses boutons', () => {
  renderPanel(botView({ status: 'limited' }));
  expect(screen.getAllByRole('button', { name: 'Passer Offline' })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Passer Online' })).toHaveLength(1);
  expect(screen.queryByRole('button', { name: ADD })).not.toBeInTheDocument();
});

// contre-audit D-1 : le panneau Statut ne promet pas de réponse tant que le compte du numéro n'est pas connecté.
test.each(['limited', 'active'] as const)('contre-audit D-1 : %s sur un compte en erreur, il dit qu\'il ne répond pas et pourquoi', (status) => {
  renderPanel(botView({ status, whatsapp_number: botNumber({ account_state: 'error' }) }));
  expect(screen.getByText(/Le compte WhatsApp de son numéro est en erreur/)).toBeInTheDocument();
  expect(screen.queryByText(/répond à tous les contacts/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Répond seulement aux numéros/)).not.toBeInTheDocument();
});

test('contre-audit D-1 : compte connecté, les descriptions habituelles restent', () => {
  renderPanel(botView({ status: 'active' }));
  expect(screen.getByText('Répond à tous les contacts qui lui écrivent.')).toBeInTheDocument();
});

test('contre-audit D-1 : brouillon et désactivé gardent leur description, compte en erreur ou non', () => {
  renderPanel(botView({ status: 'draft', whatsapp_number: botNumber({ account_state: 'error' }) }));
  expect(screen.getByText('Ne répond à personne, testez-le dans le simulateur.')).toBeInTheDocument();
  cleanup();
  renderPanel(botView({ status: 'paused', whatsapp_number: botNumber({ account_state: 'error' }) }));
  expect(screen.getByText(/^Ne répond plus\. Ses conversations sont conservées\.$/)).toBeInTheDocument();
});
