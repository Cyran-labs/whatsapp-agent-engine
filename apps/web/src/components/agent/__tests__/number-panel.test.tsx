import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach, describe } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import type { WhatsAppAccountView } from '@wabagent/contracts';
import { NumberPanel } from '../number-panel';
import { botNumber, botView } from './fixtures';
import { accountView, numberView } from '@/components/connections/__tests__/fixtures';
import { engineError, json, renderIntl, stubFetch, type Call } from '@/components/connections/__tests__/helpers';

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

function renderPanel(bot = botView(), opts: { canEdit?: boolean; canOpenConnections?: boolean } = {}) {
  const onChanged = vi.fn();
  renderIntl(<NumberPanel bot={bot} canEdit={opts.canEdit ?? true} canOpenConnections={opts.canOpenConnections ?? true} onChanged={onChanged} />);
  return { onChanged };
}

const accounts: WhatsAppAccountView[] = [
  accountView({ id: 1, numbers: [numberView({ id: 8, phone_e164: '+33612457890', display_name: 'Boutique Marais' })] }),
];

function engine(extra?: (call: Call) => Response | undefined) {
  return stubFetch((call) => extra?.(call) ?? (call.url === '/api/whatsapp-accounts' ? json(accounts) : json({})));
}

test('admin : numéro en entier, compte et son état', () => {
  renderPanel();
  expect(screen.getByText('+33 6 12 00 00 47')).toBeInTheDocument();
  // prototype 7 : « Compte WhatsApp : {nom} », jamais « Compte Compte principal »
  expect(screen.getByText('Compte WhatsApp : Compte principal')).toBeInTheDocument();
  expect(screen.getByText('Connecté')).toBeInTheDocument();
});

// prototype 15 : le numéro de l'agent IA est celui de la société, en entier pour tous les membres (spec 8)
test('conseiller : numéro de l\'agent IA en entier, jamais masqué, aucun bouton', () => {
  renderPanel(botView(), { canEdit: false, canOpenConnections: false });
  expect(screen.getByText('+33 6 12 00 00 47')).toBeInTheDocument();
  expect(screen.queryByText(/••/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('admin en lecture seule : numéro en entier, aucun bouton', () => {
  renderPanel(botView(), { canEdit: false });
  expect(screen.getByText('+33 6 12 00 00 47')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('numéro de test et compte en erreur sont signalés', () => {
  renderPanel(botView({ whatsapp_number: botNumber({ is_test: true, account_state: 'error' }) }));
  expect(screen.getByText('Numéro de test')).toBeInTheDocument();
  expect(screen.getByText('En erreur')).toBeInTheDocument();
});

test('numéro retiré chez le fournisseur : « Retiré du fournisseur » en rouge', () => {
  renderPanel(botView({ whatsapp_number: botNumber({ present: false }) }));
  const badge = screen.getByText('Retiré du fournisseur');
  expect(badge.className).toMatch(/text-danger/);
});

test('sans numéro : message et « Brancher un numéro » pour l\'admin', () => {
  renderPanel(botView({ whatsapp_number: null }));
  expect(screen.getByText(/Aucun numéro n'est branché/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Brancher un numéro' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Débrancher' })).not.toBeInTheDocument();
});

test('sans numéro, membre : le message seulement', () => {
  renderPanel(botView({ whatsapp_number: null }), { canEdit: false });
  expect(screen.getByText(/Aucun numéro n'est branché/)).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('« Brancher un numéro » ouvre le choix, « Brancher ce numéro » envoie PUT /number avec number_id', async () => {
  const calls = engine();
  const { onChanged } = renderPanel(botView({ whatsapp_number: null }));
  await userEvent.click(screen.getByRole('button', { name: 'Brancher un numéro' }));
  const dialog = await screen.findByRole('dialog', { name: 'Brancher un numéro' });
  const submit = within(dialog).getByRole('button', { name: 'Brancher ce numéro' });
  expect(submit).toBeDisabled();
  expect(submit).toHaveAccessibleDescription('Choisissez un numéro pour continuer.');
  await userEvent.click(await within(dialog).findByRole('radio', { name: /Boutique Marais/ }));
  await userEvent.click(submit);
  expect(calls.filter((c) => c.method === 'PUT')).toEqual([{ url: '/api/bots/b1/number', method: 'PUT', body: { number_id: 8, expected_bot_id: null } }]);
  expect(onChanged).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('« Changer de numéro » : le numéro actuel est reconnu dans la liste', async () => {
  engine((call) => (call.url === '/api/whatsapp-accounts'
    ? json([accountView({ numbers: [numberView({ id: 4, phone_e164: '+33612000047', bot: { bot_id: 'b1', name: 'Conseil Marais', status: 'limited', status_reason: null, not_responding: null } }), numberView({ id: 8 })] })])
    : undefined));
  renderPanel();
  await userEvent.click(screen.getByRole('button', { name: 'Changer de numéro' }));
  const dialog = await screen.findByRole('dialog', { name: 'Changer de numéro' });
  expect(await within(dialog).findByText('Numéro actuel')).toBeInTheDocument();
});

test('refus du moteur au branchement : message tel quel, la fenêtre reste ouverte', async () => {
  engine((call) => (call.method === 'PUT' ? engineError(409, 'CONFLICT', "Le compte WhatsApp de ce numéro n'est pas connecté.") : undefined));
  const { onChanged } = renderPanel(botView({ whatsapp_number: null }));
  await userEvent.click(screen.getByRole('button', { name: 'Brancher un numéro' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(await within(dialog).findByRole('radio', { name: /Boutique Marais/ }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Brancher ce numéro' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent("Le compte WhatsApp de ce numéro n'est pas connecté.");
  expect(onChanged).not.toHaveBeenCalled();
});

test('aucun numéro dans l\'organisation : message et lien vers le raccordement', async () => {
  engine((call) => (call.url === '/api/whatsapp-accounts' ? json([]) : undefined));
  renderPanel(botView({ whatsapp_number: null }));
  await userEvent.click(screen.getByRole('button', { name: 'Brancher un numéro' }));
  const dialog = await screen.findByRole('dialog');
  expect(await within(dialog).findByText(/Aucun numéro disponible/)).toBeInTheDocument();
  expect(within(dialog).getByRole('link', { name: 'Raccorder un compte WhatsApp' })).toHaveAttribute('href', '/organisation/connexions/raccorder');
});

test('liste des numéros illisible : message et « Réessayer »', async () => {
  let attempt = 0;
  engine((call) => {
    if (call.url !== '/api/whatsapp-accounts') return undefined;
    attempt += 1;
    return attempt === 1 ? new Response('{}', { status: 500 }) : json(accounts);
  });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  renderPanel(botView({ whatsapp_number: null }));
  await userEvent.click(screen.getByRole('button', { name: 'Brancher un numéro' }));
  const dialog = await screen.findByRole('dialog');
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Impossible de lire les numéros/);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Réessayer' }));
  expect(await within(dialog).findByRole('radio', { name: /Boutique Marais/ })).toBeInTheDocument();
});

test('« Débrancher » demande confirmation puis envoie POST /number/unassign avec le numéro affiché', async () => {
  const calls = engine();
  const { onChanged } = renderPanel();
  await userEvent.click(screen.getByRole('button', { name: 'Débrancher' }));
  const dialog = await screen.findByRole('dialog');
  expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  await userEvent.click(within(dialog).getByRole('button', { name: "Débrancher l'agent IA" }));
  // revue finale 2b-3 I-2
  expect(calls.filter((c) => c.method === 'POST')).toEqual([{ url: '/api/bots/b1/number/unassign', method: 'POST', body: { expected_number_id: 4 } }]);
  expect(onChanged).toHaveBeenCalledTimes(1);
});

test('débranchement refusé : le message du moteur s\'affiche dans la fenêtre', async () => {
  engine((call) => (call.method === 'POST' ? engineError(409, 'CONFLICT', 'Débranchement impossible.') : undefined));
  const { onChanged } = renderPanel();
  await userEvent.click(screen.getByRole('button', { name: 'Débrancher' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: "Débrancher l'agent IA" }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Débranchement impossible.');
  expect(onChanged).not.toHaveBeenCalled();
});

const OTHER = numberView({ id: 8, phone_e164: '+33612457890', display_name: 'Boutique Marais' });

async function openChange(bot = botView()) {
  engine((call) => (call.url === '/api/whatsapp-accounts' ? json([accountView({ numbers: [OTHER] })]) : undefined));
  renderPanel(bot);
  await userEvent.click(screen.getByRole('button', { name: 'Changer de numéro' }));
  return screen.findByRole('dialog', { name: 'Changer de numéro' });
}

test('« Changer de numéro » en accès limité : avertissement avant confirmation, statut gardé, nouveau numéro, ancien libéré', async () => {
  const dialog = await openChange(botView({ status: 'limited' }));
  expect(within(dialog).queryByText(/garde son statut/)).not.toBeInTheDocument();
  await userEvent.click(await within(dialog).findByRole('radio', { name: /Boutique Marais/ }));
  const warning = within(dialog).getByRole('status');
  expect(warning).toHaveTextContent(
    "Conseil Marais garde son statut « Preview » : il répondra tout de suite sur +33 6 12 45 78 90 aux numéros de sa Whitelist, et ne sera plus servi sur +33 6 12 00 00 47.",
  );
  expect(within(dialog).getByRole('button', { name: 'Brancher ce numéro' })).toHaveAccessibleDescription(/garde son statut/);
});

test('« Changer de numéro » d\'un agent IA actif : le nouveau numéro sert tous les contacts', async () => {
  const dialog = await openChange(botView({ status: 'active' }));
  await userEvent.click(await within(dialog).findByRole('radio', { name: /Boutique Marais/ }));
  expect(within(dialog).getByRole('status')).toHaveTextContent(/garde son statut « Online » : .* à tous les contacts, et ne sera plus servi sur \+33 6 12 00 00 47/);
});

test.each(['draft', 'paused'] as const)('« Changer de numéro » d\'un agent IA en %s : pas d\'avertissement de statut conservé', async (status) => {
  const dialog = await openChange(botView({ status }));
  await userEvent.click(await within(dialog).findByRole('radio', { name: /Boutique Marais/ }));
  expect(within(dialog).queryByText(/garde son statut/)).not.toBeInTheDocument();
});

// revue 2b-3 M-1
test('« Changer de numéro » vers un numéro tenu par un autre agent IA : son identifiant est envoyé comme détenteur attendu', async () => {
  const calls = engine((call) => (call.url === '/api/whatsapp-accounts'
    ? json([accountView({ numbers: [numberView({ id: 8, phone_e164: '+33612457890', display_name: 'Boutique Marais', bot: { bot_id: 'vente', name: 'Vente en ligne', status: 'draft', status_reason: null, not_responding: null } })] })])
    : undefined));
  renderPanel(botView({ whatsapp_number: null }));
  await userEvent.click(screen.getByRole('button', { name: 'Brancher un numéro' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(await within(dialog).findByRole('radio', { name: /Boutique Marais/ }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Brancher ce numéro' }));
  expect(calls.filter((c) => c.method === 'PUT')).toEqual([{ url: '/api/bots/b1/number', method: 'PUT', body: { number_id: 8, expected_bot_id: 'vente' } }]);
});

// revue 2b-3 M-1
test('409 « Ce numéro a changé » : message du moteur, la liste des numéros est relue, le choix est effacé', async () => {
  const stale = 'Ce numéro a changé depuis votre lecture : vérifiez la liste.';
  let listReads = 0;
  const calls = engine((call) => {
    if (call.url === '/api/whatsapp-accounts') {
      listReads += 1;
      return json(accounts);
    }
    if (call.method === 'PUT') return engineError(409, 'CONFLICT', stale, [{ path: 'expected_bot_id', message: stale }]);
    return undefined;
  });
  const { onChanged } = renderPanel(botView({ whatsapp_number: null }));
  await userEvent.click(screen.getByRole('button', { name: 'Brancher un numéro' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(await within(dialog).findByRole('radio', { name: /Boutique Marais/ }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Brancher ce numéro' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(stale);
  await waitFor(() => expect(listReads).toBe(2));
  expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  expect(onChanged).not.toHaveBeenCalled();
  expect(within(dialog).getByRole('button', { name: 'Brancher ce numéro' })).toBeDisabled();
});

// revue finale 2b-3 I-2 : l'agent IA a pris un autre numéro depuis la lecture de la page ; texte propre à cette page (tâche 15)
const CHANGED = 'Le numéro de cet agent IA a changé entre-temps. La page a été actualisée.';
test('débranchement : 409 « Ce numéro a changé », message affiché, page relue, la fenêtre survit à la relecture sans viser le nouveau numéro', async () => {
  const stale = 'Ce numéro a changé depuis votre lecture : vérifiez la liste.';
  const calls = engine((call) => (call.method === 'POST' ? engineError(409, 'CONFLICT', stale, [{ path: 'expected_bot_id', message: stale }], 'assign.holder_changed') : undefined));
  const onChanged = vi.fn();
  const view = (bot: ReturnType<typeof botView>) => (
    <NextIntlClientProvider locale="fr" messages={messages}><NumberPanel bot={bot} canEdit canOpenConnections onChanged={onChanged} /></NextIntlClientProvider>
  );
  const { rerender } = renderIntl(<NumberPanel bot={botView()} canEdit canOpenConnections onChanged={onChanged} />);
  await userEvent.click(screen.getByRole('button', { name: 'Débrancher' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('button', { name: "Débrancher l'agent IA" }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(CHANGED);
  expect(onChanged).toHaveBeenCalledTimes(1);
  // la relecture montre un autre numéro (id 9) : la fenêtre garde le numéro 4 de la demande, sans bouton de confirmation
  rerender(view(botView({ whatsapp_number: { ...botNumber(), id: 9, phone_e164: '+33699999999' } })));
  const still = screen.getByRole('dialog');
  expect(still).toHaveTextContent(CHANGED);
  expect(still).not.toHaveTextContent(stale);
  expect(within(still).queryByRole('button', { name: "Débrancher l'agent IA" })).not.toBeInTheDocument();
  expect(calls.filter((c) => c.method === 'POST')).toEqual([{ url: '/api/bots/b1/number/unassign', method: 'POST', body: { expected_number_id: 4 } }]);
});

// tâche 15 : « canOpenConnections » seule commande le lien vers Connexions ; le numéro est toujours entier
test('lien vers Connexions selon canOpenConnections, numéro en entier dans les deux cas', () => {
  const failing = botView({ whatsapp_number: botNumber({ delivery_failures: 3, last_delivery_error_code: 131047 }) });
  const { unmount } = renderIntl(<NumberPanel bot={failing} canEdit={false} canOpenConnections={false} onChanged={vi.fn()} />);
  expect(screen.getByText('+33 6 12 00 00 47')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Voir dans Connexions' })).not.toBeInTheDocument();
  unmount();
  renderIntl(<NumberPanel bot={failing} canEdit={false} canOpenConnections onChanged={vi.fn()} />);
  expect(screen.getByText('+33 6 12 00 00 47')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Voir dans Connexions' })).toHaveAttribute('href', '/organisation/connexions');
});

// tâche 15 : un numéro de test retiré chez le fournisseur ne porte que « Retiré » (comme dans le tableau de Connexions)
test('numéro de test retiré : le badge « Numéro de test » est masqué, « Retiré » reste', () => {
  renderPanel(botView({ whatsapp_number: botNumber({ is_test: true, present: false }) }));
  expect(screen.queryByText('Numéro de test')).not.toBeInTheDocument();
  expect(screen.getByText('Retiré du fournisseur')).toBeInTheDocument();
});

// audit R-22
test('audit R-22 : « Changer de numéro », Échap pendant l\'envoi ne ferme pas la fenêtre, le refus reste visible', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  stubFetch(async (call) => {
    if (call.url === '/api/whatsapp-accounts') return json([accountView({ numbers: [OTHER] })]);
    if (call.method === 'PUT') {
      await gate;
      return engineError(409, 'CONFLICT', 'Branchement impossible.');
    }
    return json({});
  });
  renderPanel();
  await userEvent.click(screen.getByRole('button', { name: 'Changer de numéro' }));
  const dialog = await screen.findByRole('dialog', { name: 'Changer de numéro' });
  await userEvent.click(await within(dialog).findByRole('radio', { name: /Boutique Marais/ }));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Brancher ce numéro' }));
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.getByRole('dialog', { name: 'Changer de numéro' })).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Annuler' })).toBeDisabled();
  release();
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Branchement impossible.');
  expect(screen.getByRole('dialog', { name: 'Changer de numéro' })).toBeInTheDocument();
});

// audit R-6
describe('échecs de remise du numéro de l\'agent IA', () => {
  const failing = (over: { delivery_failures?: number; last_delivery_error_code?: number | null; present?: boolean } = {}) =>
    botView({ whatsapp_number: botNumber({ delivery_failures: 3, last_delivery_error_code: 131047, ...over }) });

  test('admin : pastille, sens du code 131047 et lien vers Connexions, sans lien WhatsApp Manager', () => {
    renderPanel(failing());
    expect(screen.getByText('3 échecs de remise')).toBeInTheDocument();
    expect(screen.getByText(/Plus de 24 heures depuis la dernière réponse du contact/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voir dans Connexions' })).toHaveAttribute('href', '/organisation/connexions');
    expect(screen.queryByRole('link', { name: /WhatsApp Manager/ })).not.toBeInTheDocument();
  });

  // audit décisions A12 et B25 : qui ne peut pas agir reçoit une suite à donner
  test('conseiller : le nombre, le sens du code et « Prévenez un administrateur de votre organisation. », sans aucun lien', () => {
    renderPanel(failing(), { canEdit: false, canOpenConnections: false });
    expect(screen.getByText('3 échecs de remise')).toBeInTheDocument();
    expect(screen.getByText(/Plus de 24 heures depuis la dernière réponse du contact/)).toBeInTheDocument();
    expect(screen.getByText('Prévenez un administrateur de votre organisation.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  // audit décisions A12 et B25
  test('admin : le lien vers Connexions, sans la phrase destinée à qui ne peut pas agir ; conseiller en anglais : phrase traduite', () => {
    renderPanel(failing());
    expect(screen.queryByText('Prévenez un administrateur de votre organisation.')).not.toBeInTheDocument();
    cleanup();
    renderIntl(<NumberPanel bot={failing()} canEdit={false} canOpenConnections={false} onChanged={vi.fn()} />, 'en');
    expect(screen.getByText('Tell an administrator of your organization.')).toBeInTheDocument();
  });

  test('un seul échec : singulier', () => {
    renderPanel(failing({ delivery_failures: 1 }));
    expect(screen.getByText('1 échec de remise')).toBeInTheDocument();
  });

  test('code inconnu : « Code Meta N », code absent : « Code d\'erreur non communiqué »', () => {
    const { unmount } = renderIntl(<NumberPanel bot={failing({ last_delivery_error_code: 999001 })} canEdit canOpenConnections onChanged={vi.fn()} />);
    expect(screen.getByText('Code Meta 999001')).toBeInTheDocument();
    unmount();
    renderPanel(failing({ last_delivery_error_code: null }));
    expect(screen.getByText("Code d'erreur non communiqué")).toBeInTheDocument();
  });

  test('aucun échec : rien n\'est affiché', () => {
    renderPanel(failing({ delivery_failures: 0, last_delivery_error_code: null }));
    expect(screen.queryByText(/échec/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Voir dans Connexions' })).not.toBeInTheDocument();
  });

  test('numéro retiré du fournisseur : les échecs n\'ont plus de sens, rien n\'est affiché', () => {
    renderPanel(failing({ present: false }));
    expect(screen.queryByText(/échec/)).not.toBeInTheDocument();
  });

  test('aucune lecture supplémentaire : l\'encart s\'appuie sur le résumé du numéro', () => {
    const calls = stubFetch(() => json([]));
    renderPanel(failing());
    expect(calls).toHaveLength(0);
  });
});

// contre-audit D-1 : le compte en erreur est expliqué là où l'agent IA est utilisé (audit §5.1 : cause, conséquence, action).
describe('compte en erreur (contre-audit D-1)', () => {
  const errored = (error_cause: 'credentials' | 'support' | 'reconnect' | null, error_detail: string | null) =>
    botView({ whatsapp_number: botNumber({ account_state: 'error', account_error: { error_reason: 'other', error_cause, error_detail } }) });

  // décision de François du 12 nov. 2026 (recette K-6) : l'encart Numéro reprend la tête et le conseil du bandeau de
  // Connexions, sans bouton « Vérifier maintenant » (il est dans Connexions)
  test('admin : phrase du bandeau de Connexions avec le motif, conséquence et lien « Voir dans Connexions »', () => {
    renderPanel(errored('credentials', "Secret de l'app refusé"));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("La dernière vérification du compte a échoué. Motif : Secret de l'app refusé. Vérifiez de nouveau ; si cela continue, remplacez les identifiants.");
    expect(alert).toHaveTextContent('Cet agent IA ne peut pas répondre tant que le compte est en erreur.');
    expect(within(alert).getByRole('link', { name: 'Voir dans Connexions' })).toHaveAttribute('href', '/organisation/connexions');
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument();
    expect(alert).not.toHaveTextContent('Le compte est en erreur.');
    expect(alert).not.toHaveTextContent('Prévenez un administrateur');
  });

  test('membre : pas de lien, il doit prévenir un administrateur', () => {
    renderPanel(errored('credentials', 'Jeton refusé'), { canEdit: false, canOpenConnections: false });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Prévenez un administrateur de votre organisation.');
    expect(within(alert).queryByRole('link')).not.toBeInTheDocument();
  });

  test('cause support : « Contactez le support », sans conseil de remplacer les identifiants', () => {
    renderPanel(errored('support', 'Ce compte ne peut pas être raccordé. Contactez le support.'));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Ce compte ne peut pas être raccordé. Contactez le support.');
    expect(alert).not.toHaveTextContent('Remplacez les identifiants');
  });

  // revue finale M-1
  test('cause reconnect : admin, « Retirez le compte puis raccordez-le de nouveau. » ; membre, aucun conseil qu\'il ne peut pas suivre', () => {
    renderPanel(errored('reconnect', 'Identifiants enregistrés illisibles'));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('La dernière vérification du compte a échoué. Motif : Identifiants enregistrés illisibles. Retirez le compte puis raccordez-le de nouveau.');
    expect(alert).not.toHaveTextContent('Remplacez les identifiants');
    expect(within(alert).queryByRole('button')).not.toBeInTheDocument();
    cleanup();
    renderPanel(errored('reconnect', 'Identifiants enregistrés illisibles'), { canEdit: false, canOpenConnections: false });
    const member = screen.getByRole('alert');
    expect(member).not.toHaveTextContent('Retirez ce compte');
    expect(member).toHaveTextContent('Prévenez un administrateur de votre organisation.');
  });

  test('compte connecté : aucun bandeau', () => {
    renderPanel();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('en anglais : la phrase de cause seule, le motif français n\'est pas affiché en clair', () => {
    renderIntl(
      <NumberPanel bot={errored('credentials', "Secret de l'app refusé")} canEdit canOpenConnections onChanged={vi.fn()} />,
      'en',
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('The last verification of the account failed. Verify again; if this continues, replace the credentials.');
    expect(alert).toHaveTextContent('This AI agent cannot answer while the account is in error.');
    expect(within(alert).getByRole('link', { name: 'View in Connections' })).toBeInTheDocument();
    // Le motif (en français) n'est jamais affiché en clair : il n'existe que dans le détail replié.
    expect(textOutsideDetails(alert)).not.toContain("Secret de l'app refusé");
    const details = alert.querySelector('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(details).toHaveTextContent("Secret de l'app refusé");
  });

  // Témoin du test précédent : en français le même extrait contient bien le motif, donc l'extraction peut échouer.
  test('témoin : en français le motif est affiché en clair, hors du détail', () => {
    renderPanel(errored('credentials', "Secret de l'app refusé"));
    expect(textOutsideDetails(screen.getByRole('alert'))).toContain("Secret de l'app refusé");
  });

  // contre-audit (revue 18a) : un membre ne peut pas remplacer les identifiants, la phrase ne le lui demande pas.
  test('membre : la cause et la conséquence, jamais « Remplacez les identifiants du compte »', () => {
    for (const reason of ['other', 'token_invalid', 'signature_rejected'] as const) {
      const bot = botView({ whatsapp_number: botNumber({ account_state: 'error', account_error: { error_reason: reason, error_cause: 'credentials', error_detail: 'Jeton refusé' } }) });
      renderIntl(<NumberPanel bot={bot} canEdit={false} canOpenConnections={false} onChanged={vi.fn()} />);
      const alert = screen.getByRole('alert');
      expect(alert).not.toHaveTextContent(/remplacez|vérifiez|lancez/i);
      expect(alert).toHaveTextContent('Cet agent IA ne peut pas répondre tant que le compte est en erreur.');
      expect(alert).toHaveTextContent('Prévenez un administrateur de votre organisation.');
      cleanup();
    }
  });

  test('membre, cause identifiants : le motif reste dit', () => {
    renderPanel(errored('credentials', 'Secret refusé'), { canEdit: false, canOpenConnections: false });
    expect(screen.getByRole('alert')).toHaveTextContent('La dernière vérification du compte a échoué. Motif : Secret refusé.');
  });

  // décision de François du 12 nov. 2026 : même tête et même conseil que le bandeau de Connexions, pour chaque motif
  test('admin : la tête et le conseil du bandeau de Connexions, pour chaque motif', () => {
    for (const [reason, head, advice] of [
      ['other', 'La dernière vérification du compte a échoué.', 'Vérifiez de nouveau ; si cela continue, remplacez les identifiants.'],
      ['token_invalid', 'Jeton refusé par Meta.', 'Vérifiez de nouveau ; si cela continue, remplacez les identifiants.'],
      ['signature_rejected', "Les messages reçus ne sont pas signés avec le secret de l'app enregistré ici.", "Vérifiez de nouveau ; si cela continue, vérifiez le secret de l'app dans Meta, puis remplacez les identifiants."],
    ] as const) {
      const bot = botView({ whatsapp_number: botNumber({ account_state: 'error', account_error: { error_reason: reason, error_cause: 'credentials', error_detail: 'x' } }) });
      renderIntl(<NumberPanel bot={bot} canEdit canOpenConnections onChanged={vi.fn()} />);
      expect(screen.getByRole('alert')).toHaveTextContent(`${head} ${reason === 'other' ? 'Motif : x. ' : ''}${advice}`);
      cleanup();
    }
  });
});

/** Texte d'un élément sans le contenu de ses blocs `details` (replis). */
function textOutsideDetails(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('details').forEach((d) => d.remove());
  return clone.textContent ?? '';
}
