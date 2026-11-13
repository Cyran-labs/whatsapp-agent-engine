import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach, describe } from 'vitest';
import fr from '../../../../messages/fr.json';
import en from '../../../../messages/en.json';
import { AccountRunDialog } from '../account-run-dialog';
import { AssignBotDialog } from '../assign-bot-dialog';
import { ConnectForm } from '../connect-form';
import { RenameAccountDialog } from '../rename-account-dialog';
import { ReplaceCredentialsDialog } from '../replace-credentials-dialog';
import { TestFlagDialog } from '../test-flag-dialog';
import { UnassignDialog } from '../unassign-dialog';
import { accountView, numberView } from './fixtures';
import { json, renderIntl, stubFetch } from './helpers';

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

/**
 * Tâche 16b (défauts D-1 et D-2 de la tâche 16) : chaque fenêtre de Connexions lit son refus avec `describeFailure`.
 * Une panne 500 montre le texte contextuel de la fenêtre et la référence de la requête (audit R-14), jamais
 * « Erreur interne. » ; un refus à clé s'affiche dans la langue de l'interface (audit R-15), jamais le texte du moteur.
 */

const ENGINE_500 = 'Erreur interne.';
const serverError = (requestId: string): Response =>
  json({ error: { code: 'INTERNAL', message: ENGINE_500, request_id: requestId } }, 500);
const keyedRefusal = (status: number, message: string, reason: string, details?: { path: string; message: string }[]): Response =>
  json({ error: { code: status === 404 ? 'NOT_FOUND' : 'CONFLICT', message, reason, ...(details ? { details } : {}) } }, status);

const HOLDER_CHANGED_FR = 'Ce numéro a changé depuis votre lecture : vérifiez la liste.';
const holderChanged = (): Response =>
  keyedRefusal(409, HOLDER_CHANGED_FR, 'assign.holder_changed', [{ path: 'expected_bot_id', message: HOLDER_CHANGED_FR }]);

async function expectServerFailure(text: string, requestId: string, locale: 'fr' | 'en' = 'fr') {
  const reference = (locale === 'fr' ? fr : en).errors.generic.reference.replace('{reference}', requestId);
  const alert = await screen.findByText(reference);
  expect(alert.closest('[role="alert"]')).toHaveTextContent(text);
  expect(screen.queryByText(ENGINE_500)).not.toBeInTheDocument();
}

async function expectEnglishRefusal(text: string, engineFrench: string) {
  expect(await screen.findByRole('alert')).toHaveTextContent(text);
  expect(screen.queryByText(engineFrench)).not.toBeInTheDocument();
}

const account = accountView({ id: 7, name: 'Boutique principale' });
const testNumber = numberView({ id: 3, is_test: true });
const freeNumber = numberView({ id: 2, phone_e164: '+33184801234' });
const bots = [{ bot_id: 'sav', name: 'SAV commandes', status: 'draft', whatsapp_number: null }];
const unassignTarget = { number: { id: 1, phone_e164: '+33612457890' }, bot: { bot_id: 'conseil', name: 'Conseil Marais', status: 'draft' } };

/** Écrans, leur action et leur texte contextuel (celui que chacun définit déjà). */
const screens: {
  name: string;
  render: (locale: 'fr' | 'en') => void;
  act: (locale: 'fr' | 'en') => Promise<void>;
  fallback: { fr: string; en: string };
  keyed: () => Response;
  keyedEn: string;
  keyedFr: string;
}[] = [
  {
    name: 'raccorder un compte',
    render: (locale) => renderIntl(<ConnectForm onCreated={vi.fn()} />, locale),
    act: async (locale) => {
      const f = (locale === 'fr' ? fr : en).connections.connectFlow.fields;
      await userEvent.type(screen.getByLabelText(f.name), 'Boutique principale');
      await userEvent.type(screen.getByLabelText(f.wabaId), '104829371625544');
      await userEvent.type(screen.getByLabelText(f.accessToken), 'EAAG-jeton-long-1234567890');
      await userEvent.type(screen.getByLabelText(f.appSecret), 'a1b2c3d4e5f6a7b8c9d0');
      await userEvent.click(screen.getByRole('button', { name: (locale === 'fr' ? fr : en).connections.connectFlow.submit }));
    },
    fallback: { fr: fr.connections.connectFlow.errors.failed, en: en.connections.connectFlow.errors.failed },
    keyed: () => keyedRefusal(409, 'Ce compte WhatsApp est déjà raccordé.', 'whatsapp_account.already_connected'),
    keyedEn: en.errors.reasons.whatsapp_account.already_connected,
    keyedFr: 'Ce compte WhatsApp est déjà raccordé.',
  },
  {
    name: 'renommer un compte',
    render: (locale) => renderIntl(<RenameAccountDialog account={account} onClose={vi.fn()} onDone={vi.fn()} />, locale),
    act: async (locale) => userEvent.click(screen.getByRole('button', { name: (locale === 'fr' ? fr : en).connections.rename.save })),
    fallback: { fr: fr.connections.dialogs.failed, en: en.connections.dialogs.failed },
    keyed: () => keyedRefusal(404, 'Compte WhatsApp introuvable.', 'whatsapp_account.not_found'),
    keyedEn: en.errors.reasons.whatsapp_account.not_found,
    keyedFr: 'Compte WhatsApp introuvable.',
  },
  {
    name: 'remplacer les identifiants',
    render: (locale) => renderIntl(<ReplaceCredentialsDialog account={account} onClose={vi.fn()} onDone={vi.fn()} />, locale),
    act: async (locale) => {
      const c = (locale === 'fr' ? fr : en).connections.credentials;
      await userEvent.type(screen.getByLabelText(c.wabaId), '104829371625544');
      await userEvent.type(screen.getByLabelText(c.accessToken), 'EAAG-nouveau-jeton-1234567890');
      await userEvent.type(screen.getByLabelText(c.appSecret), 'a1b2c3d4e5f6a7b8c9d0');
      await userEvent.click(screen.getByRole('button', { name: c.submit }));
    },
    fallback: { fr: fr.connections.dialogs.failed, en: en.connections.dialogs.failed },
    keyed: () => keyedRefusal(409, 'Pour une autre WABA ou un autre compte CM.com, raccordez un nouveau compte.', 'whatsapp_account.other_provider_account'),
    keyedEn: en.errors.reasons.whatsapp_account.other_provider_account,
    keyedFr: 'Pour une autre WABA ou un autre compte CM.com, raccordez un nouveau compte.',
  },
  {
    name: 'vérifier maintenant',
    render: (locale) => renderIntl(<AccountRunDialog kind="verify" account={account} onClose={vi.fn()} onDone={vi.fn()} />, locale),
    act: async () => undefined,
    fallback: { fr: fr.connections.dialogs.failed, en: en.connections.dialogs.failed },
    keyed: () => keyedRefusal(409, 'Ce compte WhatsApp a été retiré : raccordez un nouveau compte.', 'whatsapp_account.disconnected'),
    keyedEn: en.errors.reasons.whatsapp_account.disconnected,
    keyedFr: 'Ce compte WhatsApp a été retiré : raccordez un nouveau compte.',
  },
  {
    name: 'rafraîchir les numéros',
    render: (locale) => renderIntl(<AccountRunDialog kind="refresh" account={account} onClose={vi.fn()} onDone={vi.fn()} />, locale),
    act: async () => undefined,
    fallback: { fr: fr.connections.dialogs.failed, en: en.connections.dialogs.failed },
    keyed: () => keyedRefusal(409, 'Les identifiants enregistrés de ce compte sont illisibles : retirez le compte puis raccordez-le de nouveau.', 'whatsapp_account.secrets_unreadable'),
    keyedEn: en.errors.reasons.whatsapp_account.secrets_unreadable,
    keyedFr: 'Les identifiants enregistrés de ce compte sont illisibles : retirez le compte puis raccordez-le de nouveau.',
  },
  {
    name: 'marquer un numéro de test',
    render: (locale) => renderIntl(<TestFlagDialog account={account} number={testNumber} onClose={vi.fn()} onDone={vi.fn()} />, locale),
    act: async (locale) => userEvent.click(screen.getByRole('button', { name: (locale === 'fr' ? fr : en).connections.testFlag.unmarkConfirm })),
    fallback: { fr: fr.connections.dialogs.failed, en: en.connections.dialogs.failed },
    keyed: () => keyedRefusal(404, 'Numéro WhatsApp introuvable.', 'whatsapp_account.number_not_found'),
    keyedEn: en.errors.reasons.whatsapp_account.number_not_found,
    keyedFr: 'Numéro WhatsApp introuvable.',
  },
  {
    name: 'brancher un numéro',
    render: (locale) => renderIntl(<AssignBotDialog number={freeNumber} accountState="connected" onClose={vi.fn()} onDone={vi.fn()} onStale={vi.fn()} />, locale),
    act: async (locale) => {
      await userEvent.click(await screen.findByRole('radio', { name: /SAV commandes/ }));
      await userEvent.click(screen.getByRole('button', { name: (locale === 'fr' ? fr : en).connections.assign.submit }));
    },
    fallback: { fr: fr.connections.dialogs.failed, en: en.connections.dialogs.failed },
    keyed: holderChanged,
    keyedEn: en.errors.reasons.assign.holder_changed,
    keyedFr: HOLDER_CHANGED_FR,
  },
  {
    name: 'débrancher',
    render: (locale) => renderIntl(<UnassignDialog target={unassignTarget} onClose={vi.fn()} onDone={vi.fn()} onStale={vi.fn()} />, locale),
    act: async (locale) => userEvent.click(screen.getByRole('button', { name: (locale === 'fr' ? fr : en).connections.unassign.confirm })),
    fallback: { fr: fr.connections.dialogs.failed, en: en.connections.dialogs.failed },
    keyed: holderChanged,
    keyedEn: en.errors.reasons.assign.holder_changed,
    keyedFr: HOLDER_CHANGED_FR,
  },
];

/** Le faux moteur répond `write` aux écritures ; la liste des agents IA de la fenêtre « Brancher » se lit normalement. */
function engine(write: () => Response) {
  stubFetch((call) => (call.url === '/api/bots' && call.method === 'GET' ? json(bots) : write()));
}

describe.each(screens)('Connexions, $name', ({ render, act, fallback, keyed, keyedEn, keyedFr }) => {
  // audit R-14
  test('panne 500 : texte contextuel de la fenêtre et référence de la requête, jamais « Erreur interne. »', async () => {
    engine(() => serverError('req-cnx-1'));
    render('fr');
    await act('fr');
    await expectServerFailure(fallback.fr, 'req-cnx-1');
  });

  // audit R-14
  test('panne 500 en anglais : texte contextuel anglais et référence', async () => {
    engine(() => serverError('req-cnx-2'));
    render('en');
    await act('en');
    await expectServerFailure(fallback.en, 'req-cnx-2', 'en');
  });

  // audit R-15
  test('refus à clé en anglais : texte anglais de la clé, jamais le texte français du moteur', async () => {
    engine(keyed);
    render('en');
    await act('en');
    await expectEnglishRefusal(keyedEn, keyedFr);
  });
});

// La clé de contrôle `app_secret` est aussi un champ du formulaire : un contrôle en échec (422) ne va pas sous le champ.
// audit décisions A19 : le contrôle reste dans la liste (son détail une seule fois) et le champ est marqué en plus
test('remplacer les identifiants, 422 : le contrôle app_secret reste dans la liste des contrôles, et le champ est marqué', async () => {
  stubFetch(() =>
    json({ error: { code: 'WA_VALIDATION_FAILED', message: 'Vérification du compte impossible.', reason: 'whatsapp_account.verification_failed', details: [{ path: 'app_secret', message: 'Secret incorrect' }] } }, 422),
  );
  renderIntl(<ReplaceCredentialsDialog account={account} onClose={vi.fn()} onDone={vi.fn()} />);
  await userEvent.type(screen.getByLabelText('WABA ID'), '104829371625544');
  await userEvent.type(screen.getByLabelText("Jeton d'accès"), 'EAAG-nouveau-jeton-1234567890');
  await userEvent.type(screen.getByLabelText("Secret de l'app Meta"), 'a1b2c3d4e5f6a7b8c9d0');
  await userEvent.click(screen.getByRole('button', { name: 'Remplacer' }));
  const list = await screen.findByRole('list', { name: 'Contrôles de vérification' });
  expect(within(list).getByText('Secret incorrect')).toBeInTheDocument();
  expect(screen.getByLabelText("Secret de l'app Meta")).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText("Secret de l'app Meta")).toHaveAccessibleDescription(fr.connections.checks.fieldRefused);
  expect(screen.getAllByText('Secret incorrect')).toHaveLength(1);
});

// contre-audit D-3
test('contre-audit D-3 : renommer, refus du moteur sur le nom : le focus revient au champ, marqué invalide', async () => {
  stubFetch(() => json({ error: { code: 'VALIDATION_ERROR', message: 'Données invalides.', details: [{ path: 'name', message: 'Le nom est requis.' }] } }, 400));
  renderIntl(<RenameAccountDialog account={account} onClose={vi.fn()} onDone={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: fr.connections.rename.save }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Le nom est requis.');
  await waitFor(() => expect(screen.getByLabelText(fr.connections.rename.label)).toHaveFocus());
  expect(screen.getByLabelText(fr.connections.rename.label)).toHaveAttribute('aria-invalid', 'true');
});

// spec R1 §6.3 : chaque raison nouvelle du lot R1 a son texte, en français et en anglais, affiché au raccordement
// à la place du texte du moteur (le moteur répond ces raisons au raccordement, à « Vérifier maintenant » et à
// « Faire pointer vers WABAGENT »).
// Audit des décisions R1 N-5 (A-7) : `meta_unavailable`, panne passagère de Meta pendant l'inscription.
const R1_REASONS = ['public_url_missing', 'webhook_unreachable', 'webhook_unconfirmed', 'webhook_url_too_long', 'app_webhook_failed', 'meta_unavailable'] as const;

describe.each(R1_REASONS)('restitution : raison R1 %s', (reason) => {
  test('texte en français et en anglais, distincts et non vides', () => {
    const textFr = fr.errors.reasons.whatsapp_account[reason];
    const textEn = en.errors.reasons.whatsapp_account[reason];
    expect(textFr.length).toBeGreaterThan(10);
    expect(textEn.length).toBeGreaterThan(10);
    expect(textEn).not.toBe(textFr);
  });

  test.each(['fr', 'en'] as const)('raccordement refusé (%s) : le texte de la clé, jamais celui du moteur', async (locale) => {
    const engineText = 'Texte du moteur que le web ne montre pas.';
    stubFetch(() => keyedRefusal(422, engineText, `whatsapp_account.${reason}`));
    screens[0]!.render(locale);
    await screens[0]!.act(locale);
    expect(await screen.findByRole('alert')).toHaveTextContent((locale === 'fr' ? fr : en).errors.reasons.whatsapp_account[reason]);
    expect(screen.queryByText(engineText)).not.toBeInTheDocument();
  });
});

test('public_url_missing : texte de la spec', () => {
  expect(fr.errors.reasons.whatsapp_account.public_url_missing).toBe(
    "La plateforme n'a pas d'adresse publique pour recevoir les messages. Contactez le support.",
  );
});

// relecture finale R1 FR-I1 : le bilan du retrait (webhook_cleanup) et la mention de panne passagère (transient) ne
// sont pas des contrôles ; le bilan se dit en une phrase, neutre si le retrait a réussi, en alerte s'il a échoué, sur
// le 422, sur le 409 d'un raccordement concurrent et sur l'erreur interne d'un enregistrement en échec (spec R1 §5.2).
describe('raccordement refusé après l\'inscription : bilan du retrait', () => {
  const unreachable = (cleanup: 'done' | 'failed'): Response => json({ error: {
    code: 'WA_VALIDATION_FAILED', message: 'Texte du moteur.', reason: 'whatsapp_account.webhook_unreachable', details: [
      { path: 'webhook_waba', message: 'Meta a renvoyé une erreur' },
      { path: 'transient', message: 'Le fournisseur ne répond pas, réessayez.' },
      { path: `webhook_cleanup.${cleanup}`, message: 'Texte du moteur sur le retrait.' },
    ] } }, 422);

  test.each(['fr', 'en'] as const)('422, retrait réussi (%s) : phrase neutre, ni contrôle « webhook_cleanup » ni « transient »', async (locale) => {
    const m = locale === 'fr' ? fr : en;
    stubFetch(() => unreachable('done'));
    screens[0]!.render(locale);
    await screens[0]!.act(locale);
    const list = await screen.findByRole('list', { name: m.connections.checks.listLabel });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(list).toHaveTextContent(m.connections.checks.keys.webhook_waba);
    expect(screen.queryByText(/webhook_cleanup|transient/)).not.toBeInTheDocument();
    const notice = screen.getByText(m.connections.checks.cleanupDone);
    expect(notice.closest('[data-cleanup]')).toHaveAttribute('data-cleanup', 'done');
    expect(notice.className).not.toMatch(/warning|danger/);
    expect(screen.queryByText('Texte du moteur sur le retrait.')).not.toBeInTheDocument();
  });

  test('422, retrait en échec : phrase d\'alerte', async () => {
    stubFetch(() => unreachable('failed'));
    screens[0]!.render('fr');
    await screens[0]!.act('fr');
    const notice = await screen.findByText(fr.connections.checks.cleanupFailed);
    expect(notice.className).toMatch(/warning/);
    expect(screen.queryByText(fr.connections.checks.cleanupDone)).not.toBeInTheDocument();
  });

  test('409 après l\'écriture (raccordement concurrent) : le refus et le bilan du retrait', async () => {
    stubFetch(() => keyedRefusal(409, 'Ce compte WhatsApp est déjà raccordé.', 'whatsapp_account.already_connected', [
      { path: 'webhook_cleanup.failed', message: 'Texte du moteur sur le retrait.' },
    ]));
    screens[0]!.render('fr');
    await screens[0]!.act('fr');
    expect(await screen.findByRole('alert')).toHaveTextContent('Ce compte WhatsApp est déjà raccordé.');
    expect(screen.getByText(fr.connections.checks.cleanupFailed)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: fr.connections.checks.listLabel })).not.toBeInTheDocument();
  });

  test('500 d\'un enregistrement en échec : texte de panne, référence et bilan du retrait', async () => {
    stubFetch(() => json({ error: {
      code: 'INTERNAL', message: ENGINE_500, request_id: 'req-cleanup-1', details: [{ path: 'webhook_cleanup.done', message: 'Texte du moteur sur le retrait.' }],
    } }, 500));
    screens[0]!.render('fr');
    await screens[0]!.act('fr');
    await expectServerFailure(screens[0]!.fallback.fr, 'req-cleanup-1');
    expect(screen.getByText(fr.connections.checks.cleanupDone)).toBeInTheDocument();
  });

  // Relecture R1, round 2, M-1 : rien de WABAGENT n'était en place, la phrase ne dit pas « a été retirée ».
  test.each(['fr', 'en'] as const)('rien de WABAGENT en place (%s) : phrase neutre, jamais « retirée »', async (locale) => {
    const m = locale === 'fr' ? fr : en;
    stubFetch(() => json({ error: {
      code: 'WA_VALIDATION_FAILED', message: 'Texte du moteur.', reason: 'whatsapp_account.meta_unavailable', details: [
        { path: 'webhook_waba', message: 'Délai dépassé' }, { path: 'transient', message: 'x' }, { path: 'webhook_cleanup.nothing', message: 'Texte du moteur.' },
      ] } }, 422));
    screens[0]!.render(locale);
    await screens[0]!.act(locale);
    const notice = await screen.findByText(m.connections.checks.cleanupNothing);
    expect(notice.className).not.toMatch(/warning|danger/);
    expect(screen.queryByText(m.connections.checks.cleanupDone)).not.toBeInTheDocument();
    expect(screen.queryByText(/webhook_cleanup|webhook_previous/)).not.toBeInTheDocument();
    if (locale === 'fr') expect(m.connections.checks.cleanupNothing).toBe("Rien de WABAGENT n'est resté chez Meta.");
  });

  // Relecture R1, round 2, I-1 : l'adresse d'un autre outil remplacée puis non rétablie est dite par son domaine, lue par clé.
  test.each(['fr', 'en'] as const)('adresse précédente non rétablie (%s) : phrase d\'alerte avec le domaine, texte du moteur jamais affiché', async (locale) => {
    const m = locale === 'fr' ? fr : en;
    stubFetch(() => json({ error: {
      code: 'INTERNAL', message: ENGINE_500, request_id: 'req-lost-1', details: [
        { path: 'webhook_cleanup.done', message: 'Texte du moteur sur le retrait.' },
        { path: 'webhook_previous.lost', message: 'Texte du moteur sur l\'adresse précédente.', host: 'autre-outil.example.com' },
      ] } }, 500));
    screens[0]!.render(locale);
    await screens[0]!.act(locale);
    const sentence = m.connections.checks.previousLost.replace('{host}', 'autre-outil.example.com');
    const notice = await screen.findByText(sentence);
    expect(notice.className).toMatch(/warning/);
    expect(screen.queryByText("Texte du moteur sur l'adresse précédente.")).not.toBeInTheDocument();
  });
});
