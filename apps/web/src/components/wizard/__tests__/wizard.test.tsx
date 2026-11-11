import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, test, expect } from 'vitest';
import type { Session } from '@/components/providers/session-provider';
import type { OrganizationSummary } from '@/lib/organizations';
import { NavigationGuardProvider } from '@/components/shell/navigation-guard';
import { Wizard } from '../wizard';
import { accountView, numberView } from '@/components/connections/__tests__/fixtures';
import { engineError, json, renderIntl, stubFetch } from '@/components/connections/__tests__/helpers';

const nav = vi.hoisted(() => ({ push: vi.fn() }));
/** Entité que le moteur a enregistrée pour l'agent IA créé (réponse de la création). */
const entityOfCreatedBot = vi.hoisted(() => ({ id: 4 as number | null }));
vi.mock('@/i18n/routing', () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  usePathname: () => '/agents/new',
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const ml: OrganizationSummary = { client_id: 'ml', name: 'Maison Lumière', role: 'admin', read_only: false };
const an: OrganizationSummary = { client_id: 'an', name: 'Atelier Nord', role: 'admin', read_only: false };
const session = vi.hoisted(() => ({ current: null as unknown as Session }));
vi.mock('@/components/providers/session-provider', () => ({ useSession: () => session.current }));

// Les étapes 1 à 4 ont leurs propres tests : ici elles ne servent qu'à atteindre l'étape 5.
vi.mock('../step-identity', () => ({
  StepIdentity: ({ onNext, onBack, update, errors }: { onNext: () => void; onBack: () => void; update: (p: { name: string }) => void; errors: { name?: string } }) => (
    <div>
      {errors.name && <span>erreur du nom : {errors.name}</span>}
      <button onClick={() => update({ name: 'Ventes' })}>saisir</button>
      <button onClick={() => update({ name: 'Ventes Pro' })}>renommer</button>
      <button onClick={() => { update({ name: 'Ventes' }); onNext(); }}>identité</button>
      <button onClick={onBack}>annuler</button>
    </div>
  ),
}));
vi.mock('../step-personality', () => ({
  StepPersonality: ({ onCreated, update, personalityRefusal, onLeadDraftChange }: {
    onCreated: (id: string, entityId: number | null) => void;
    update: (p: { welcomeEnabled: boolean }) => void;
    personalityRefusal: number;
    onLeadDraftChange: (text: string) => void;
  }) => (
    <div>
      <span>refus de la personnalité : {personalityRefusal}</span>
      <button onClick={() => update({ welcomeEnabled: false })}>modifier</button>
      <button onClick={() => onLeadDraftChange('e-mail')}>taper un champ</button>
      <button onClick={() => onCreated('ventes', entityOfCreatedBot.id)}>personnalité</button>
    </div>
  ),
}));
vi.mock('../step-test', () => ({
  StepTest: ({ onNext }: { onNext: () => void }) => <button onClick={onNext}>test</button>,
}));
vi.mock('../step-number', () => ({
  StepNumber: ({ numberId, onChange, onNext, onLater }: { numberId: number | null; onChange: (id: number) => void; onNext: () => void; onLater: () => void }) => (
    <div>
      <span>numéro retenu : {String(numberId)}</span>
      <button onClick={() => onChange(1)}>choisir</button>
      <button onClick={onNext}>continuer</button>
      <button onClick={onLater}>plus tard</button>
    </div>
  ),
}));

/** E.164 du numéro dans la réponse du moteur à l'activation (la lecture, elle, dit +33612457890). */
const activatedPhone = { value: '+33612457890' };

function sessionOf(orgs: OrganizationSummary[]): Session {
  return {
    me: { id: 1, email: 'claire@x.fr', role: 'user', status: 'active', organizations: orgs },
    activeOrg: ml,
    isPlatformAdmin: false,
    isAdmin: true,
    readOnly: false,
    switchOrg: vi.fn(async () => ({ ok: true as const })),
    notice: null,
    dismissNotice: vi.fn(),
    refresh: vi.fn(),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  activatedPhone.value = '+33612457890';
  nav.push.mockClear();
  entityOfCreatedBot.id = 4;
  session.current = sessionOf([ml]);
  patchAnswer.value = null;
});

function renderWizard(props: React.ComponentProps<typeof Wizard> = {}) {
  return renderIntl(<NavigationGuardProvider><Wizard {...props} /></NavigationGuardProvider>);
}

/** Réponse du moteur au PATCH de l'agent IA créé (renvoi des modifications) ; null : succès. */
const patchAnswer = { value: null as Response | null };

function stub() {
  return stubFetch((c) => {
    if (c.url === '/api/entities') return json([{ id: 4, name: 'Boutique Paris Marais', status: 'active', bots: 0, members: 1 }]);
    if (c.method === 'PATCH') return patchAnswer.value ?? json({ bot_id: 'ventes', entity_id: 4 });
    if (c.method === 'POST') return json({ bot_id: 'ventes', status: 'limited', whatsapp_number: { id: 1, phone_e164: activatedPhone.value } });
    return json([accountView({ numbers: [numberView({ id: 1, phone_e164: '+33612457890' })] })]);
  });
}

async function reachStep5() {
  renderWizard({ initialEntityId: 4 });
  await userEvent.click(await screen.findByRole('button', { name: 'identité' }));
  await userEvent.click(screen.getByRole('button', { name: 'personnalité' }));
  await userEvent.click(screen.getByRole('button', { name: 'test' }));
  await userEvent.click(screen.getByRole('button', { name: 'choisir' }));
  await userEvent.click(screen.getByRole('button', { name: 'continuer' }));
  await screen.findByText('Compte WhatsApp connecté', { exact: false });
}

test('l\'étape 4 mène à l\'étape 5, qui connaît l\'entité et le numéro retenu', async () => {
  stub();
  await reachStep5();
  expect(screen.getByText('5 / 5')).toBeInTheDocument();
  expect(screen.getByText('Boutique Paris Marais')).toBeInTheDocument();
  expect(screen.getByText('+33 6 12 45 78 90')).toBeInTheDocument();
});

test('l\'entité vient de la réponse du moteur : une organisation à une seule entité, où rien n\'a été choisi, la voit nommée', async () => {
  stub();
  renderWizard();
  await userEvent.click(await screen.findByRole('button', { name: 'identité' }));
  await userEvent.click(screen.getByRole('button', { name: 'personnalité' }));
  await userEvent.click(screen.getByRole('button', { name: 'test' }));
  await userEvent.click(screen.getByRole('button', { name: 'choisir' }));
  await userEvent.click(screen.getByRole('button', { name: 'continuer' }));
  expect(await screen.findByText('Boutique Paris Marais')).toBeInTheDocument();
});

test('réponse du moteur sans entité : « Aucune entité »', async () => {
  entityOfCreatedBot.id = null;
  stub();
  await reachStep5();
  expect(screen.getByText('Aucune entité')).toBeInTheDocument();
});

test('« Changer de numéro » revient à l\'étape 4 en gardant le numéro retenu', async () => {
  stub();
  await reachStep5();
  await userEvent.click(screen.getByRole('button', { name: /Changer de numéro/ }));
  expect(await screen.findByText('numéro retenu : 1')).toBeInTheDocument();
});

test('la Whitelist saisie survit à « Changer de numéro » puis au retour à l\'étape 5', async () => {
  stub();
  await reachStep5();
  await userEvent.type(screen.getByLabelText('Numéro à autoriser'), '+33612345678{Enter}');
  await userEvent.click(screen.getByRole('button', { name: /Changer de numéro/ }));
  await userEvent.click(await screen.findByRole('button', { name: 'continuer' }));
  await screen.findByText('Compte WhatsApp connecté', { exact: false });
  expect(screen.getByText('+33 6 12 34 56 78')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Activer en Preview' })).toBeEnabled();
});

test('« Laisser en Draft » mène à la fin en Draft, avec « Brancher un numéro »', async () => {
  const calls = stub();
  await reachStep5();
  await userEvent.click(screen.getByRole('button', { name: 'Laisser en Draft' }));
  expect(await screen.findByRole('link', { name: /Brancher un numéro/ })).toHaveAttribute('href', '/agents/ventes');
  expect(calls.some((c) => c.method === 'POST')).toBe(false);
});

test('activation réussie : écran de confirmation avec le numéro, le QR code et le lien wa.me', async () => {
  stub();
  await reachStep5();
  await userEvent.type(screen.getByLabelText('Numéro à autoriser'), '+33612345678{Enter}');
  await userEvent.click(screen.getByRole('button', { name: 'Activer en Preview' }));
  expect(await screen.findByRole('heading', { name: 'Ventes est en Preview' })).toBeInTheDocument();
  expect(screen.getByText('Preview')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /wa\.me\/33612457890/ })).toHaveAttribute('href', 'https://wa.me/33612457890');
  const qr = await screen.findByRole('img', { name: /QR code/ });
  await waitFor(() => expect(qr.getAttribute('src')).toMatch(/^data:image\/png/));
  expect(screen.queryByText('5 / 5')).not.toBeInTheDocument();
});

// revue 2b-3 M-3
test('le QR code et le lien wa.me portent le numéro de la réponse du moteur, pas celui de la lecture précédente', async () => {
  const qrcode = await import('qrcode');
  const toDataURL = vi.spyOn(qrcode.default, 'toDataURL').mockResolvedValue('data:image/png;base64,AAAA' as never);
  activatedPhone.value = '+33699999999';
  stub();
  await reachStep5();
  await userEvent.type(screen.getByLabelText('Numéro à autoriser'), '+33612345678{Enter}');
  await userEvent.click(screen.getByRole('button', { name: 'Activer en Preview' }));
  expect(await screen.findByRole('heading', { name: 'Ventes est en Preview' })).toBeInTheDocument();
  expect(screen.getByText('+33 6 99 99 99 99')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /wa\.me\/33699999999/ })).toHaveAttribute('href', 'https://wa.me/33699999999');
  await waitFor(() => expect(toDataURL).toHaveBeenCalled());
  expect(toDataURL.mock.calls.map(([text]) => text)).toEqual(['https://wa.me/33699999999']);
  expect(document.body.textContent).not.toContain('33612457890');
});

/** Ligne grise qui précède « ✕ Quitter » dans la barre du haut. */
function quitHint(): string {
  const quit = screen.getByRole('button', { name: /Quitter/ });
  return quit.parentElement?.textContent?.replace(quit.textContent ?? '', '').trim() ?? '';
}

// prototype 6 : l'assistant garde le cadre normal, l'organisation est visible
test('cadre normal : rail, colonne avec le stepper vertical, fil « Org › Agents IA › Créer un agent IA »', async () => {
  stub();
  renderWizard();
  expect(screen.getByRole('navigation', { name: 'Navigation principale' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Agents IA', current: 'page' })).toHaveAttribute('href', '/');
  expect(screen.getByRole('list', { name: "Étapes de l'assistant" })).toBeInTheDocument();
  const trail = screen.getByRole('navigation', { name: "Fil d'Ariane" });
  expect(within(trail).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Maison Lumière', 'Agents IA', 'Créer un agent IA']);
  expect(within(trail).getByRole('link', { name: 'Agents IA' })).toHaveAttribute('href', '/');
  expect(screen.getByText('Maison Lumière', { selector: '[data-org-block] *' })).toBeInTheDocument();
  await screen.findByRole('button', { name: 'identité' });
});

test('ligne de « Quitter » aux trois moments : rien d\'enregistré, Draft dans la liste, fin', async () => {
  stub();
  renderWizard();
  await screen.findByRole('button', { name: 'identité' });
  expect(quitHint()).toBe("Retour à Agents IA : rien n'est enregistré");
  await userEvent.click(screen.getByRole('button', { name: 'identité' }));
  await userEvent.click(screen.getByRole('button', { name: 'personnalité' }));
  expect(quitHint()).toBe('Retour à Agents IA : le Draft reste dans la liste');
  await userEvent.click(screen.getByRole('button', { name: 'test' }));
  await userEvent.click(screen.getByRole('button', { name: 'plus tard' }));
  expect(await screen.findByRole('heading', { name: 'Draft enregistré' })).toBeInTheDocument();
  expect(quitHint()).toBe('Retour à la liste des agents IA');
});

/** Ouvre le sélecteur d'organisation de la colonne et choisit Atelier Nord. */
async function chooseOtherOrg(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: /Maison Lumière/ }));
  await userEvent.click(screen.getByRole('button', { name: /Atelier Nord/ }));
}

// spec 12.4 : aucune saisie, aucune fenêtre
test('rien de saisi : « Quitter » ramène à la liste sans fenêtre', async () => {
  stub();
  renderWizard();
  await screen.findByRole('button', { name: 'identité' });
  await userEvent.click(screen.getByRole('button', { name: /Quitter/ }));
  await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

// spec 12.4, choix P-8 : avant la création, une saisie serait perdue
test('saisie avant la création : fenêtre sur un clic du rail, d\'un lien de la colonne, du fil et de « Quitter » ; « Rester » ne navigue pas', async () => {
  stub();
  renderWizard();
  await userEvent.click(await screen.findByRole('button', { name: 'saisir' }));

  const leaves: HTMLElement[] = [
    within(screen.getByRole('navigation', { name: 'Navigation principale' })).getByRole('link', { name: 'Agents IA' }),
    screen.getByRole('link', { name: /Tous les agents IA/ }),
    within(screen.getByRole('navigation', { name: "Fil d'Ariane" })).getByRole('link', { name: 'Agents IA' }),
    screen.getByRole('button', { name: /Quitter/ }),
  ];
  for (const leave of leaves) {
    await userEvent.click(leave);
    const dialog = await screen.findByRole('dialog', { name: 'Quitter la création ?' });
    expect(dialog).toHaveTextContent("Ce que vous avez saisi n'est pas encore enregistré.");
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rester' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  }
  expect(nav.push).not.toHaveBeenCalled();
  // La saisie est toujours là : l'étape 1 n'a pas bougé.
  expect(screen.getByRole('button', { name: 'saisir' })).toBeInTheDocument();
});

test('saisie avant la création : « Quitter sans enregistrer » ramène à la liste', async () => {
  stub();
  renderWizard();
  await userEvent.click(await screen.findByRole('button', { name: 'saisir' }));
  await userEvent.click(screen.getByRole('button', { name: /Quitter/ }));
  await userEvent.click(await screen.findByRole('button', { name: 'Quitter sans enregistrer' }));
  await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/'));
});

test('« Annuler » de l\'étape 1 passe par la même confirmation', async () => {
  stub();
  renderWizard();
  await userEvent.click(await screen.findByRole('button', { name: 'saisir' }));
  await userEvent.click(screen.getByRole('button', { name: 'annuler' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Rester' }));
  expect(nav.push).not.toHaveBeenCalled();
});

// spec 12.4 : changer d'organisation depuis l'assistant passe par la même confirmation
test('sélecteur d\'organisation : fenêtre avant le changement ; « Rester » ne change rien, « Quitter sans enregistrer » change', async () => {
  session.current = sessionOf([ml, an]);
  stub();
  renderWizard();
  await userEvent.click(await screen.findByRole('button', { name: 'saisir' }));
  await chooseOtherOrg();
  await userEvent.click(await screen.findByRole('button', { name: 'Rester' }));
  expect(session.current.switchOrg).not.toHaveBeenCalled();

  await chooseOtherOrg();
  await userEvent.click(await screen.findByRole('button', { name: 'Quitter sans enregistrer' }));
  await waitFor(() => expect(session.current.switchOrg).toHaveBeenCalledWith('an'));
});

test('sélecteur d\'organisation : refus après la confirmation, le menu se rouvre avec le message', async () => {
  session.current = { ...sessionOf([ml, an]), switchOrg: vi.fn(async () => ({ ok: false as const, message: 'Atelier Nord ne peut pas être ouverte.', reference: null })) };
  stub();
  renderWizard();
  await userEvent.click(await screen.findByRole('button', { name: 'saisir' }));
  await chooseOtherOrg();
  await userEvent.click(await screen.findByRole('button', { name: 'Quitter sans enregistrer' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Atelier Nord ne peut pas être ouverte.');
});

// spec 12.4 : après la création, sans saisie en attente, le Draft reste dans la liste
test('après la création, rien en attente : aucune fenêtre', async () => {
  stub();
  renderWizard();
  await userEvent.click(await screen.findByRole('button', { name: 'identité' }));
  await userEvent.click(screen.getByRole('button', { name: 'personnalité' }));
  await userEvent.click(screen.getByRole('button', { name: /Quitter/ }));
  await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

// spec 12.4 : une modification de l'étape 2 non renvoyée serait perdue
test('après la création, modification de l\'étape 2 non renvoyée : fenêtre ; renvoyée : plus de fenêtre', async () => {
  stub();
  renderWizard();
  await userEvent.click(await screen.findByRole('button', { name: 'identité' }));
  await userEvent.click(screen.getByRole('button', { name: 'personnalité' }));
  await userEvent.click(screen.getByRole('button', { name: /Personnalité \(terminée\)/ }));
  await userEvent.click(screen.getByRole('button', { name: 'modifier' }));
  await userEvent.click(screen.getByRole('button', { name: /Quitter/ }));
  await userEvent.click(await screen.findByRole('button', { name: 'Rester' }));
  expect(nav.push).not.toHaveBeenCalled();

  // « Créer et tester » renvoie la modification : la sortie est libre.
  await userEvent.click(screen.getByRole('button', { name: 'personnalité' }));
  await userEvent.click(screen.getByRole('button', { name: /Quitter/ }));
  await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('stepper : une étape atteinte y ramène, l\'encadré d\'état suit la création', async () => {
  stub();
  renderWizard();
  expect(screen.getByText("Rien n'est enregistré avant « Créer et tester » (étape 2).")).toBeInTheDocument();
  await userEvent.click(await screen.findByRole('button', { name: 'identité' }));
  await userEvent.click(screen.getByRole('button', { name: 'personnalité' }));
  expect(screen.getByText('Draft enregistré')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /Identité \(terminée\)/ }));
  expect(screen.getByRole('button', { name: 'identité' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /Tester \(à reprendre\)/ }));
  expect(screen.getByRole('button', { name: 'test' })).toBeInTheDocument();
});

test('fin en Draft après un passage à l\'étape 5 : « Activer » n\'est pas cochée, les étapes faites le sont, rien n\'est cliquable', async () => {
  stub();
  await reachStep5();
  await userEvent.click(screen.getByRole('button', { name: 'Laisser en Draft' }));
  await screen.findByRole('heading', { name: 'Draft enregistré' });
  const items = within(screen.getByRole('list', { name: "Étapes de l'assistant" })).getAllByRole('listitem');
  expect(items[3]).toHaveTextContent('✓');
  expect(items[4]).not.toHaveTextContent('✓');
  expect(within(screen.getByRole('list', { name: "Étapes de l'assistant" })).queryAllByRole('button')).toHaveLength(0);
});

/** Création faite (étape 3), puis retour à l'étape 1 par le stepper et nom modifié : une modification non envoyée. */
async function renameAfterCreation(): Promise<void> {
  renderWizard();
  await userEvent.click(await screen.findByRole('button', { name: 'identité' }));
  await userEvent.click(screen.getByRole('button', { name: 'personnalité' }));
  await screen.findByRole('button', { name: 'test' });
  await userEvent.click(screen.getByRole('button', { name: /Identité \(terminée\)/ }));
  await userEvent.click(screen.getByRole('button', { name: 'renommer' }));
}

// relecture tâche 13, I-1 : un saut par le stepper ne laisse pas une modification derrière lui
test('saut vers une étape suivante avec une modification en attente : le PATCH part d\'abord, puis l\'étape s\'ouvre', async () => {
  const calls = stub();
  await renameAfterCreation();
  await userEvent.click(screen.getByRole('button', { name: /Tester \(à reprendre\)/ }));
  expect(await screen.findByRole('button', { name: 'test' })).toBeInTheDocument();
  const patch = calls.filter((c) => c.method === 'PATCH');
  expect(patch).toHaveLength(1);
  expect(patch[0]!.url).toBe('/api/bots/ventes');
  expect((patch[0]!.body as { name: string }).name).toBe('Ventes Pro');
  // Plus rien en attente : la sortie est libre, l'encadré nomme ce que le moteur a.
  expect(screen.getByText(/« Ventes Pro » est dans la liste des agents IA/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /Quitter/ }));
  await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/'));
});

test('saut sans modification en attente : aucun envoi', async () => {
  const calls = stub();
  renderWizard();
  await userEvent.click(await screen.findByRole('button', { name: 'identité' }));
  await userEvent.click(screen.getByRole('button', { name: 'personnalité' }));
  await userEvent.click(screen.getByRole('button', { name: /Identité \(terminée\)/ }));
  await userEvent.click(screen.getByRole('button', { name: /Tester \(à reprendre\)/ }));
  expect(await screen.findByRole('button', { name: 'test' })).toBeInTheDocument();
  expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
});

// relecture tâche 13, I-1 : envoi en échec, on reste, le refus est affiché
test('saut, envoi en panne : on reste sur l\'étape, le refus et sa référence sont affichés, la garde reste posée', async () => {
  stub();
  patchAnswer.value = json({ error: { code: 'INTERNAL', message: 'Erreur interne.', request_id: 'r-42' } }, 500);
  await renameAfterCreation();
  await userEvent.click(screen.getByRole('button', { name: /Tester \(à reprendre\)/ }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Action impossible pour le moment. Réessayez.');
  expect(alert).toHaveTextContent('r-42');
  expect(screen.getByRole('button', { name: 'renommer' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'test' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /Quitter/ }));
  expect(await screen.findByRole('dialog', { name: 'Quitter la création ?' })).toBeInTheDocument();
});

test('saut, nom refusé par le moteur : retour à l\'étape 1 avec l\'erreur sous le champ', async () => {
  stub();
  patchAnswer.value = engineError(400, 'VALIDATION_ERROR', 'Données invalides.', [{ path: 'name', message: 'Nom trop long.' }]);
  await renameAfterCreation();
  await userEvent.click(screen.getByRole('button', { name: /Numéro \(à reprendre\)|Tester \(à reprendre\)/ }));
  expect(await screen.findByText(/erreur du nom :/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'renommer' })).toBeInTheDocument();
});

test('saut, personnalité de la langue par défaut refusée : retour à l\'étape 2 qui le montre', async () => {
  stub();
  patchAnswer.value = engineError(400, 'VALIDATION_ERROR', 'Données invalides.', [{ path: 'system_prompt', message: 'Aucune personnalité.' }], 'bot.default_language_missing');
  await renameAfterCreation();
  await userEvent.click(screen.getByRole('button', { name: /Tester \(à reprendre\)/ }));
  expect(await screen.findByText('refus de la personnalité : 1')).toBeInTheDocument();
});

// relecture tâche 13, M-4 : l'encadré ne dit pas « vos réglages sont gardés » pendant qu'une modification attend
test('encadré : une modification en attente le dit, et le nom affiché reste celui du moteur', async () => {
  stub();
  await renameAfterCreation();
  expect(screen.queryByText(/Vous pouvez quitter : vos réglages sont gardés\./)).not.toBeInTheDocument();
  expect(screen.getByText(/« Ventes » est dans la liste des agents IA, en Draft\. Vos dernières modifications ne sont pas encore enregistrées/)).toBeInTheDocument();
});

// relecture tâche 13, M-1 : un champ de lead tapé sans « Ajouter » est une saisie
test('champ de lead tapé sans être ajouté, après la création : fenêtre de sortie', async () => {
  stub();
  renderWizard();
  await userEvent.click(await screen.findByRole('button', { name: 'identité' }));
  await userEvent.click(screen.getByRole('button', { name: 'personnalité' }));
  await userEvent.click(screen.getByRole('button', { name: /Personnalité \(terminée\)/ }));
  await userEvent.click(screen.getByRole('button', { name: 'taper un champ' }));
  await userEvent.click(screen.getByRole('button', { name: /Quitter/ }));
  expect(await screen.findByRole('dialog', { name: 'Quitter la création ?' })).toBeInTheDocument();
});

// relecture tâche 13, M-1 : la Whitelist saisie à l'étape 5 est une saisie
test.each([
  ['un numéro ajouté', '+33612345678{Enter}'],
  ['un numéro tapé sans « Ajouter »', '+33612345678'],
])('Whitelist de l\'étape 5 (%s) : fenêtre de sortie', async (_case, typed) => {
  stub();
  await reachStep5();
  await userEvent.type(screen.getByLabelText('Numéro à autoriser'), typed);
  await userEvent.click(screen.getByRole('button', { name: /Quitter/ }));
  expect(await screen.findByRole('dialog', { name: 'Quitter la création ?' })).toBeInTheDocument();
});

test('« Retour aux agents IA » de l\'écran de fin passe par la garde', async () => {
  stub();
  renderWizard();
  await userEvent.click(await screen.findByRole('button', { name: 'identité' }));
  await userEvent.click(screen.getByRole('button', { name: 'personnalité' }));
  await userEvent.click(screen.getByRole('button', { name: 'test' }));
  await userEvent.click(screen.getByRole('button', { name: 'plus tard' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Retour aux agents IA' }));
  await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/'));
});
