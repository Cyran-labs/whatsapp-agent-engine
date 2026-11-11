import { useState } from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, test, expect } from 'vitest';
import { StepNumber } from '../step-number';
import { accountView, numberView } from '@/components/connections/__tests__/fixtures';
import { bindApiFetch, type ApiFetchBinding } from '@/lib/api-fetch';
import { describedBy, engineError, isReadableMuted, json, renderIntl, stubFetch, type Call } from '@/components/connections/__tests__/helpers';

// Le vrai Link préfixe la langue (/fr/...) ; ici on contrôle la cible brute et les attributs transmis.
vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

beforeEach(() => vi.restoreAllMocks());

const free = numberView({ id: 1, phone_e164: '+33612457890', display_name: 'Maison Lumière Marais' });
const used = numberView({
  id: 2,
  phone_e164: '+33184801234',
  bot: { bot_id: 'support-client', name: 'Support client', status: 'active', status_reason: null, not_responding: null },
});
const accounts = [accountView({ id: 1, name: 'Maison Lumière France', numbers: [free, used] })];

function props(over: Partial<React.ComponentProps<typeof StepNumber>> = {}): React.ComponentProps<typeof StepNumber> {
  return { botId: 'ventes', numberId: null, onChange: vi.fn(), onBack: vi.fn(), onNext: vi.fn(), onLater: vi.fn(), ...over };
}

/** L'assistant tient le choix : le composant testé le reçoit et le remonte, comme dans `Wizard`. */
function Controlled(p: Omit<React.ComponentProps<typeof StepNumber>, 'numberId' | 'onChange'> & { onChange: (id: number | null) => void }) {
  const [numberId, setNumberId] = useState<number | null>(null);
  return <StepNumber {...p} numberId={numberId} onChange={(id) => { setNumberId(id); p.onChange(id); }} />;
}

test('Continuer est désactivé tant qu\'aucun numéro n\'est choisi, avec sa raison affichée', async () => {
  stubFetch(() => json(accounts));
  renderIntl(<StepNumber {...props()} />);
  await screen.findByRole('radio', { name: /\+33 6 12 45 78 90/ });
  const next = screen.getByRole('button', { name: 'Continuer' });
  expect(next).toBeDisabled();
  const reason = screen.getByText('Choisissez un numéro pour continuer.');
  expect(next).toHaveAttribute('aria-describedby', reason.id);
});

test('choisir un numéro le remonte, Continuer appelle onNext', async () => {
  stubFetch(() => json(accounts));
  const p = props();
  renderIntl(<Controlled {...p} />);
  await userEvent.click(await screen.findByRole('radio', { name: /\+33 6 12 45 78 90/ }));
  expect(p.onChange).toHaveBeenCalledWith(1);
  const next = screen.getByRole('button', { name: 'Continuer' });
  expect(next).toBeEnabled();
  expect(screen.queryByText('Choisissez un numéro pour continuer.')).not.toBeInTheDocument();
  await userEvent.click(next);
  expect(p.onNext).toHaveBeenCalledTimes(1);
});

test('l\'étape ne fait que retenir le choix : aucune requête d\'écriture', async () => {
  const calls = stubFetch(() => json(accounts));
  const p = props({ numberId: 2 });
  renderIntl(<StepNumber {...p} />);
  await screen.findByRole('radio', { name: /\+33 1 84 80 12 34/ });
  await userEvent.click(screen.getByRole('radio', { name: /\+33 6 12 45 78 90/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Continuer' }));
  await userEvent.click(screen.getByRole('button', { name: 'Plus tard' }));
  await userEvent.click(screen.getByRole('button', { name: /Retour au test/ }));
  expect(calls.every((c: Call) => c.method === 'GET')).toBe(true);
  expect(calls.map((c) => c.url)).toEqual(['/api/whatsapp-accounts']);
});

test('« Plus tard » et « Retour au test » appellent leurs rappels', async () => {
  stubFetch(() => json(accounts));
  const p = props();
  renderIntl(<StepNumber {...p} />);
  await screen.findByRole('radio', { name: /\+33 6 12 45 78 90/ });
  await userEvent.click(screen.getByRole('button', { name: 'Plus tard' }));
  expect(p.onLater).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: /Retour au test/ }));
  expect(p.onBack).toHaveBeenCalledTimes(1);
});

test('lien de raccordement vers la page dédiée, dans un nouvel onglet', async () => {
  stubFetch(() => json(accounts));
  renderIntl(<StepNumber {...props()} />);
  const link = await screen.findByRole('link', { name: /Raccorder un autre compte WhatsApp/ });
  expect(link).toHaveAttribute('href', '/organisation/connexions/raccorder');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
});

test('aucun numéro raccordé : bloc vide, lien de raccordement et « Laisser en Draft »', async () => {
  stubFetch(() => json([]));
  const p = props();
  renderIntl(<StepNumber {...p} />);
  expect(await screen.findByText('Aucun numéro WhatsApp raccordé')).toBeInTheDocument();
  const link = screen.getByRole('link', { name: /Raccorder un compte WhatsApp/ });
  expect(link).toHaveAttribute('href', '/organisation/connexions/raccorder');
  expect(link).toHaveAttribute('target', '_blank');
  expect(screen.queryByRole('button', { name: 'Continuer' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Laisser en Draft et terminer' }));
  expect(p.onLater).toHaveBeenCalledTimes(1);
});

test('des comptes sans numéro utilisable donnent le même état vide', async () => {
  stubFetch(() => json([accountView({ state: 'disconnected' })]));
  renderIntl(<StepNumber {...props()} />);
  expect(await screen.findByText('Aucun numéro WhatsApp raccordé')).toBeInTheDocument();
});

test('le retour sur l\'onglet relance la lecture des comptes et fait apparaître un numéro raccordé entre-temps', async () => {
  let list = [] as typeof accounts;
  const calls = stubFetch(() => json(list));
  renderIntl(<StepNumber {...props()} />);
  expect(await screen.findByText('Aucun numéro WhatsApp raccordé')).toBeInTheDocument();
  expect(calls).toHaveLength(1);

  list = accounts;
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(await screen.findByRole('radio', { name: /\+33 6 12 45 78 90/ })).toBeInTheDocument();
  expect(calls.map((c) => c.url)).toEqual(['/api/whatsapp-accounts', '/api/whatsapp-accounts']);
});

test('un visibilitychange vers hidden ne relit rien', async () => {
  const calls = stubFetch(() => json(accounts));
  renderIntl(<StepNumber {...props()} />);
  await screen.findByRole('radio', { name: /\+33 6 12 45 78 90/ });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(calls).toHaveLength(1);
});

test('le choix qui a disparu de la liste est oublié : Continuer redevient désactivé', async () => {
  let list = accounts;
  stubFetch(() => json(list));
  const onChange = vi.fn();
  renderIntl(<StepNumber {...props({ numberId: 1, onChange })} />);
  await screen.findByRole('radio', { name: /\+33 6 12 45 78 90/ });
  expect(screen.getByRole('button', { name: 'Continuer' })).toBeEnabled();

  list = [accountView({ id: 1, name: 'Maison Lumière France', numbers: [used] })];
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  await screen.findByRole('radio', { name: /\+33 1 84 80 12 34/ });
  expect(onChange).toHaveBeenCalledWith(null);
  expect(screen.getByRole('button', { name: 'Continuer' })).toBeDisabled();
});

test('lecture impossible : message, Réessayer, Continuer désactivé avec sa raison, Plus tard reste possible', async () => {
  let fail = true;
  stubFetch(() => (fail ? engineError(500, 'INTERNAL', 'Erreur interne') : json(accounts)));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const p = props();
  renderIntl(<StepNumber {...p} />);
  expect(await screen.findByText('Impossible de charger les numéros WhatsApp.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Continuer' })).toBeDisabled();
  expect(screen.getByText(/Les numéros n'ont pas pu être chargés/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Plus tard' }));
  expect(p.onLater).toHaveBeenCalledTimes(1);
  fail = false;
  await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByRole('radio', { name: /\+33 6 12 45 78 90/ })).toBeInTheDocument();
});

test('relecture en échec au retour sur l\'onglet : la liste affichée est conservée', async () => {
  let fail = false;
  stubFetch(() => (fail ? engineError(500, 'INTERNAL', 'Erreur interne') : json(accounts)));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  renderIntl(<StepNumber {...props()} />);
  await screen.findByRole('radio', { name: /\+33 6 12 45 78 90/ });
  fail = true;
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(screen.getByRole('radio', { name: /\+33 6 12 45 78 90/ })).toBeInTheDocument();
  expect(screen.queryByText('Impossible de charger les numéros WhatsApp.')).not.toBeInTheDocument();
});

test('409 ORG_CHANGED : la session est prévenue, rien n\'est affiché, pas d\'erreur parasite', async () => {
  const binding: ApiFetchBinding = { displayedOrg: 'ml', onOrgChanged: vi.fn(), onOrgError: vi.fn(), onUnauthorized: vi.fn() };
  bindApiFetch(binding);
  const calls = stubFetch(() => engineError(409, 'ORG_CHANGED', 'Organisation changée'));
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    renderIntl(<StepNumber {...props()} />);
    await waitFor(() => expect(binding.onOrgChanged).toHaveBeenCalledTimes(1));
    expect(calls).toHaveLength(1);
    // Laisse le traitement de la réponse (isOrgChanged, puis suite de la lecture) se terminer.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    // Sans le retour anticipé, la réponse non ok donnerait « Impossible de charger » et une erreur journalisée.
    expect(screen.getByRole('status')).toHaveTextContent('Chargement des numéros…');
    expect(screen.queryByText('Impossible de charger les numéros WhatsApp.')).not.toBeInTheDocument();
    expect(screen.queryByText('Aucun numéro WhatsApp raccordé')).not.toBeInTheDocument();
    expect(logged).not.toHaveBeenCalled();
  } finally {
    bindApiFetch(null);
  }
});

test('réponse périmée : la dernière lecture demandée gagne, même résolue en premier', async () => {
  const pending: Array<(res: Response) => void> = [];
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { pending.push(resolve); })));
  renderIntl(<StepNumber {...props()} />);
  await waitFor(() => expect(pending).toHaveLength(1));
  await act(async () => { pending[0]!(json(accounts)); });
  await screen.findByRole('radio', { name: /\+33 6 12 45 78 90/ });

  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  // Seule la date est simulée : deux retours séparés de moins de 5 s ne donnent qu'une relecture (revue finale 2b-3 m-2).
  vi.useFakeTimers({ toFake: ['Date'] });
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  vi.setSystemTime(Date.now() + 10_000);
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  vi.useRealTimers();
  expect(pending).toHaveLength(3);
  const older = [accountView({ id: 1, name: 'Ancienne lecture', numbers: [numberView({ id: 8, phone_e164: '+33699887766' })] })];
  const newer = [accountView({ id: 1, name: 'Dernière lecture', numbers: [numberView({ id: 9, phone_e164: '+33611223344' })] })];
  // Résolues dans l'ordre inverse de la demande.
  await act(async () => { pending[2]!(json(newer)); });
  await act(async () => { pending[1]!(json(older)); });
  expect(await screen.findByRole('radio', { name: /\+33 6 11 22 33 44/ })).toBeInTheDocument();
  expect(screen.queryByRole('radio', { name: /\+33 6 99 88 77 66/ })).not.toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Dernière lecture' })).toBeInTheDocument();
});

test('après le démontage, un visibilitychange ne relit plus rien', async () => {
  const calls = stubFetch(() => json(accounts));
  const { unmount } = renderIntl(<StepNumber {...props()} />);
  await screen.findByRole('radio', { name: /\+33 6 12 45 78 90/ });
  expect(calls).toHaveLength(1);
  unmount();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(calls).toHaveLength(1);
});

// prototype 6 (spec 12.3) : l'avertissement est visible sur la ligne avant de la cocher
test('un numéro utilisé par un autre agent IA est choisissable et l\'avertissement le nomme avant le choix', async () => {
  stubFetch(() => json(accounts));
  const p = props();
  renderIntl(<Controlled {...p} />);
  expect(await screen.findByText(/sera débranché de ce numéro/)).toHaveTextContent('Support client sera débranché de ce numéro et passera Offline : il ne répondra plus.');
  expect(screen.getByRole('radio', { name: /\+33 1 84 80 12 34/ })).not.toBeChecked();
  await userEvent.click(screen.getByRole('radio', { name: /\+33 1 84 80 12 34/ }));
  expect(p.onChange).toHaveBeenCalledWith(2);
  expect(screen.getByRole('button', { name: 'Continuer' })).toBeEnabled();
});

// prototype 6 (spec 12.3) : compte WhatsApp en erreur signalé dès l'étape 4 ; recette 3.7, Ruling T8 préoccupation 4 :
// l'assistant ne branche qu'à l'activation, un numéro d'un compte en erreur n'y est pas choisissable
test('compte en erreur : son numéro est affiché non choisissable avec sa raison, Continuer reste désactivé', async () => {
  const broken = accountView({ id: 2, name: 'Compte Lyon', state: 'error', error_reason: 'token_invalid', numbers: [numberView({ id: 8, phone_e164: '+33688888888' })] });
  stubFetch(() => json([...accounts, broken]));
  const p = props();
  renderIntl(<Controlled {...p} />);
  const radio = await screen.findByRole('radio', { name: /\+33 6 88 88 88 88/ });
  expect(radio).toBeDisabled();
  expect(within(screen.getByRole('group', { name: 'Compte Lyon' })).getByText("Le compte WhatsApp de ce numéro n'est pas connecté.")).toBeInTheDocument();
  expect(radio).toHaveAccessibleDescription("Le compte WhatsApp de ce numéro n'est pas connecté.");
  await userEvent.click(radio);
  expect(p.onChange).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Continuer' })).toBeDisabled();
});

// recette 3.7
test('seuls des numéros de comptes en erreur : la liste les montre (pas l\'état vide), rien n\'est choisissable', async () => {
  const broken = accountView({ id: 2, name: 'Compte Lyon', state: 'error', error_reason: 'token_invalid', numbers: [numberView({ id: 8, phone_e164: '+33688888888' })] });
  stubFetch(() => json([broken]));
  renderIntl(<StepNumber {...props()} />);
  expect(await screen.findByRole('radio', { name: /\+33 6 88 88 88 88/ })).toBeDisabled();
  expect(screen.queryByText('Aucun numéro WhatsApp raccordé')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Continuer' })).toBeDisabled();
  // relecture tâche 13, M-3 : la raison dit qu'aucun numéro n'est utilisable, pas « Choisissez un numéro »
  expect(describedBy(screen.getByRole('button', { name: 'Continuer' }))).toHaveTextContent("Aucun numéro n'est utilisable : le compte WhatsApp n'est pas connecté. Réparez-le dans Connexions, ou choisissez Plus tard.");
});

// recette 3.7
test('le choix retenu sur un compte passé en erreur est oublié à la relecture', async () => {
  const onChange = vi.fn();
  const broken = accountView({ id: 1, name: 'Maison Lumière France', state: 'error', error_reason: 'token_invalid', numbers: [free, used] });
  stubFetch(() => json([broken]));
  renderIntl(<StepNumber {...props({ numberId: 1, onChange })} />);
  await screen.findByRole('radio', { name: /\+33 6 12 45 78 90/ });
  await waitFor(() => expect(onChange).toHaveBeenCalledWith(null));
});

// revue finale 2b-3 (contraste)
test('contraste : la raison de « Continuer » désactivé est en text-muted', async () => {
  stubFetch(() => json(accounts));
  renderIntl(<StepNumber {...props()} />);
  await screen.findByRole('radio', { name: /\+33 6 12 45 78 90/ });
  expect(isReadableMuted(describedBy(screen.getByRole('button', { name: 'Continuer' })))).toBe(true);
});
