import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
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

function renderPanel(bot = botView(), opts: { canEdit?: boolean; seeFull?: boolean } = {}) {
  const onChanged = vi.fn();
  renderIntl(<NumberPanel bot={bot} canEdit={opts.canEdit ?? true} seeFull={opts.seeFull ?? true} onChanged={onChanged} />);
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
  expect(screen.getByText('Compte Compte principal')).toBeInTheDocument();
  expect(screen.getByText('Connecté')).toBeInTheDocument();
});

test('membre : numéro masqué, aucun bouton', () => {
  renderPanel(botView(), { canEdit: false, seeFull: false });
  expect(screen.getByText('+33612 •• •• 47')).toBeInTheDocument();
  expect(screen.queryByText(/\+33 6 12 00 00 47/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('admin en lecture seule : numéro en entier, aucun bouton', () => {
  renderPanel(botView(), { canEdit: false, seeFull: true });
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
  renderPanel(botView({ whatsapp_number: null }), { canEdit: false, seeFull: false });
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
  expect(calls.filter((c) => c.method === 'PUT')).toEqual([{ url: '/api/bots/b1/number', method: 'PUT', body: { number_id: 8 } }]);
  expect(onChanged).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('« Changer de numéro » : le numéro actuel est reconnu dans la liste', async () => {
  engine((call) => (call.url === '/api/whatsapp-accounts'
    ? json([accountView({ numbers: [numberView({ id: 4, phone_e164: '+33612000047', bot: { bot_id: 'b1', name: 'Conseil Marais', status: 'limited' } }), numberView({ id: 8 })] })])
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

test('« Débrancher » demande confirmation puis envoie DELETE /number', async () => {
  const calls = engine();
  const { onChanged } = renderPanel();
  await userEvent.click(screen.getByRole('button', { name: 'Débrancher' }));
  const dialog = await screen.findByRole('dialog');
  expect(calls).toEqual([]);
  await userEvent.click(within(dialog).getByRole('button', { name: "Débrancher l'agent IA" }));
  expect(calls).toEqual([{ url: '/api/bots/b1/number', method: 'DELETE', body: undefined }]);
  expect(onChanged).toHaveBeenCalledTimes(1);
});

test('débranchement refusé : le message du moteur s\'affiche dans la fenêtre', async () => {
  engine((call) => (call.method === 'DELETE' ? engineError(409, 'CONFLICT', 'Débranchement impossible.') : undefined));
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
    "Conseil Marais garde son statut « Accès limité » : il répondra tout de suite sur +33 6 12 45 78 90 aux numéros de sa liste d'accès limité, et ne sera plus servi sur +33 6 12 00 00 47.",
  );
  expect(within(dialog).getByRole('button', { name: 'Brancher ce numéro' })).toHaveAccessibleDescription(/garde son statut/);
});

test('« Changer de numéro » d\'un agent IA actif : le nouveau numéro sert tous les contacts', async () => {
  const dialog = await openChange(botView({ status: 'active' }));
  await userEvent.click(await within(dialog).findByRole('radio', { name: /Boutique Marais/ }));
  expect(within(dialog).getByRole('status')).toHaveTextContent(/garde son statut « Actif » : .* à tous les contacts, et ne sera plus servi sur \+33 6 12 00 00 47/);
});

test.each(['draft', 'paused'] as const)('« Changer de numéro » d\'un agent IA en %s : pas d\'avertissement de statut conservé', async (status) => {
  const dialog = await openChange(botView({ status }));
  await userEvent.click(await within(dialog).findByRole('radio', { name: /Boutique Marais/ }));
  expect(within(dialog).queryByText(/garde son statut/)).not.toBeInTheDocument();
});
