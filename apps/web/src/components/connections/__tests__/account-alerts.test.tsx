import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { test, expect, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import messagesEn from '../../../../messages/en.json';
import { AccountAlerts } from '../account-alerts';
import { accountView, numberView } from './fixtures';
import type { WhatsAppAccountView } from '@wabagent/contracts';

const NOW = new Date('2026-11-09T10:00:00.000Z');

const CANNOT_CONNECT = 'Ce compte ne peut pas être raccordé. Contactez le support.';

const LAST_CHECK_FAILED = 'La dernière vérification du compte a échoué.';
const RETRY_THEN_REPLACE = 'Vérifiez de nouveau ; si cela continue, remplacez les identifiants.';

function renderAlerts(account: WhatsAppAccountView, onReplaceCredentials?: () => void, locale: 'fr' | 'en' = 'fr', onVerify?: () => void) {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'fr' ? messages : messagesEn}>
      <AccountAlerts account={account} now={NOW} onReplaceCredentials={onReplaceCredentials} onVerify={onVerify} />
    </NextIntlClientProvider>,
  );
}

test('jeton qui expire : « 12 jours » et la marche à suivre', () => {
  renderAlerts(accountView({ alerts: [{ kind: 'token_expiring', at: '2026-11-21T10:00:00.000Z' }] }));
  expect(screen.getByText('Le jeton expire dans 12 jours.')).toBeInTheDocument();
  expect(screen.getByText(/jeton d'utilisateur système sans expiration/)).toBeInTheDocument();
  // Sans fenêtre de remplacement fournie : pas de bouton, le bandeau nomme l'action du menu du compte.
  expect(screen.queryByRole('button', { name: 'Remplacer les identifiants' })).not.toBeInTheDocument();
  expect(screen.getByText(/« Remplacer les identifiants »/)).toBeInTheDocument();
});

// spec 10.7 : le bandeau d'expiration ouvre la même fenêtre que le bandeau d'erreur
test('jeton qui expire : bouton « Remplacer les identifiants » qui ouvre la fenêtre de remplacement', async () => {
  const onReplace = vi.fn();
  renderAlerts(accountView({ alerts: [{ kind: 'token_expiring', at: '2026-11-21T10:00:00.000Z' }] }), onReplace);
  const banner = screen.getByRole('status');
  expect(banner).toHaveTextContent('Le jeton expire dans 12 jours.');
  await userEvent.click(within(banner).getByRole('button', { name: 'Remplacer les identifiants' }));
  expect(onReplace).toHaveBeenCalledTimes(1);
  expect(banner).not.toHaveTextContent('menu « Gérer »');
});

// relecture tâche 10, I-2 : identifiants illisibles, le moteur refuse le remplacement (409 secrets_unreadable) ; le
// bandeau d'expiration ne propose pas le bouton et dit la seule suite possible, comme le menu du compte
test('jeton qui expire sur un compte aux identifiants illisibles : aucun bouton Remplacer, « Retirez ce compte… »', () => {
  const onReplace = vi.fn();
  renderAlerts(
    accountView({
      state: 'error', error_reason: 'other', error_detail: 'Identifiants enregistrés illisibles', error_cause: 'reconnect',
      alerts: [{ kind: 'token_expiring', at: '2026-11-21T10:00:00.000Z' }],
    }),
    onReplace,
  );
  expect(screen.queryByRole('button', { name: 'Remplacer les identifiants' })).not.toBeInTheDocument();
  const banner = screen.getByRole('status');
  expect(banner).toHaveTextContent('Le jeton expire dans 12 jours. Retirez le compte puis raccordez-le de nouveau.');
  expect(banner).not.toHaveTextContent('Remplacer les identifiants');
});

test('jeton qui expire dans un jour : singulier ; déjà expiré : message dédié', () => {
  const { unmount } = renderAlerts(accountView({ alerts: [{ kind: 'token_expiring', at: '2026-11-10T09:00:00.000Z' }] }));
  expect(screen.getByText('Le jeton expire dans 1 jour.')).toBeInTheDocument();
  unmount();
  renderAlerts(accountView({ alerts: [{ kind: 'token_expiring', at: '2026-11-01T09:00:00.000Z' }] }));
  expect(screen.getByText('Le jeton a expiré.')).toBeInTheDocument();
});

test('compte en erreur, jeton refusé : bandeau d\'erreur du jeton', () => {
  renderAlerts(accountView({ state: 'error', error_reason: 'token_invalid' }));
  expect(screen.getByRole('alert')).toHaveTextContent(`Jeton refusé par Meta. ${RETRY_THEN_REPLACE}`);
});

test('compte en erreur, jeton refusé sur CM.com : nomme le productToken et CM.com, jamais Meta', () => {
  renderAlerts(accountView({ mode: 'cm_com', waba_id: null, meta_app_id: null, state: 'error', error_reason: 'token_invalid' }));
  expect(screen.getByRole('alert')).toHaveTextContent(`productToken refusé par CM.com. ${RETRY_THEN_REPLACE}`);
  expect(screen.getByRole('alert')).not.toHaveTextContent('Meta');
});

test('compte en erreur, signature rejetée : bandeau du secret de l\'app', () => {
  renderAlerts(accountView({ state: 'error', error_reason: 'signature_rejected' }));
  expect(screen.getByRole('alert')).toHaveTextContent("Les messages reçus ne sont pas signés avec le secret de l'app");
  expect(screen.getByRole('alert')).toHaveTextContent(RETRY_THEN_REPLACE);
});

// audit R-5
test('erreur « autre » pour une app non conforme : le motif du moteur en clair, « Contactez le support », jamais de reprise automatique', () => {
  const replace = vi.fn();
  renderAlerts(accountView({ state: 'error', error_reason: 'other', error_detail: CANNOT_CONNECT, error_cause: 'support' }), replace);
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent(CANNOT_CONNECT);
  expect(alert).not.toHaveTextContent('reprise automatique');
  expect(alert).not.toHaveTextContent('reprise automatiquement');
  // remplacer les identifiants ne sert à rien pour une app tenue ailleurs : pas de bouton
  expect(screen.queryByRole('button', { name: 'Remplacer les identifiants' })).not.toBeInTheDocument();
});

// audit R-5
// recette 3.6 : vérifier de nouveau d'abord, remplacer les identifiants si cela continue
test('erreur « autre » d\'un contrôle refusé (secret, WABA) : le motif en clair, « si cela continue, remplacez les identifiants » avec le bouton', async () => {
  const replace = vi.fn();
  renderAlerts(accountView({ state: 'error', error_reason: 'other', error_detail: "Secret de l'app refusé", error_cause: 'credentials' }), replace);
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent(`${LAST_CHECK_FAILED} Motif : Secret de l'app refusé. ${RETRY_THEN_REPLACE}`);
  expect(alert).not.toHaveTextContent('reprise automatique');
  await userEvent.click(screen.getByRole('button', { name: 'Remplacer les identifiants' }));
  expect(replace).toHaveBeenCalledTimes(1);
});

// audit R-5
test('le conseil suit error_cause et non le texte : le texte du moteur « Contactez le support » en cause « credentials » garde le bouton', () => {
  renderAlerts(accountView({ state: 'error', error_reason: 'other', error_detail: CANNOT_CONNECT, error_cause: 'credentials' }), vi.fn());
  expect(screen.getByRole('button', { name: 'Remplacer les identifiants' })).toBeInTheDocument();
});

// revue finale M-1 : des identifiants illisibles ne se remplacent pas (le moteur refuse en 409 secrets_unreadable).
test('cause « reconnect » : le motif en clair, « Retirez le compte puis raccordez-le de nouveau. », sans bouton Remplacer', () => {
  renderAlerts(accountView({ state: 'error', error_reason: 'other', error_detail: 'Identifiants enregistrés illisibles', error_cause: 'reconnect' }), vi.fn());
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent(`${LAST_CHECK_FAILED} Motif : Identifiants enregistrés illisibles. Retirez le compte puis raccordez-le de nouveau.`);
  expect(alert).not.toHaveTextContent('Remplacez les identifiants');
  expect(screen.queryByRole('button', { name: 'Remplacer les identifiants' })).not.toBeInTheDocument();
});

test('interface anglaise, cause « reconnect » : phrase traduite, motif français replié, sans bouton Replace', () => {
  renderAlerts(accountView({ state: 'error', error_reason: 'other', error_detail: 'Identifiants enregistrés illisibles', error_cause: 'reconnect' }), vi.fn(), 'en');
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('The last verification of the account failed. Remove the account, then connect it again.');
  const outside = alert.cloneNode(true) as HTMLElement;
  outside.querySelectorAll('details').forEach((d) => d.remove());
  expect(outside).not.toHaveTextContent('illisibles');
  expect(screen.getByText('Details from WABAGENT (in French)').closest('details')).toHaveTextContent('Identifiants enregistrés illisibles');
  expect(screen.queryByRole('button', { name: 'Replace credentials' })).not.toBeInTheDocument();
});

// audit R-5, recette 3.6
test('erreur sans motif connu (motif absent ou « autre » sans texte) : « Vérifiez de nouveau pour connaître le motif. », aucune reprise automatique', () => {
  const { unmount } = renderAlerts(accountView({ state: 'error', error_reason: 'other', error_detail: null }));
  expect(screen.getByRole('alert')).toHaveTextContent(`${LAST_CHECK_FAILED} Vérifiez de nouveau pour connaître le motif.`);
  expect(screen.getByRole('alert')).not.toHaveTextContent('reprise automatique');
  unmount();
  renderAlerts(accountView({ state: 'error', error_reason: null, error_detail: null }));
  expect(screen.getByRole('alert')).toHaveTextContent(`${LAST_CHECK_FAILED} Vérifiez de nouveau pour connaître le motif.`);
  expect(screen.getByRole('alert')).not.toHaveTextContent('reprise automatique');
});

// audit R-21 : le texte du fournisseur vient de provider_text du moteur, jamais d'une lecture du motif
test('provider_text : phrase traduite dans le bandeau, texte du fournisseur dans un détail repliable fermé', () => {
  renderAlerts(accountView({
    state: 'error', error_reason: 'other', error_detail: 'Meta a renvoyé une erreur', error_cause: 'credentials', provider_text: '(#100) Invalid parameter',
  }), vi.fn());
  const details = screen.getByText('Texte renvoyé par le fournisseur').closest('details');
  expect(details).not.toBeNull();
  expect(details).not.toHaveAttribute('open');
  expect(details).toHaveTextContent('(#100) Invalid parameter');
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent(LAST_CHECK_FAILED);
  expect(alert).toHaveTextContent(RETRY_THEN_REPLACE);
  const outside = alert.cloneNode(true) as HTMLElement;
  outside.querySelector('details')?.remove();
  expect(outside).not.toHaveTextContent('Invalid parameter');
});

// audit R-21
test('sans provider_text : aucun détail repliable, même si le motif commence par « Meta : » (rien n\'est lu dans le texte)', () => {
  renderAlerts(accountView({ state: 'error', error_reason: 'other', error_detail: 'Meta : Réponse de Meta illisible', error_cause: 'credentials', provider_text: null }), vi.fn());
  expect(screen.queryByText('Texte renvoyé par le fournisseur')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Réponse de Meta illisible');
});

// audit R-21
test('jeton refusé avec provider_text : même détail repliable', () => {
  renderAlerts(accountView({ state: 'error', error_reason: 'token_invalid', error_detail: 'Jeton refusé par Meta', provider_text: 'Error validating access token' }));
  expect(screen.getByText('Texte renvoyé par le fournisseur').closest('details')).toHaveTextContent('Error validating access token');
});

// revue Minor 3 : en anglais, jamais le français du moteur en clair
test('interface anglaise : phrase de la cause seulement, le motif du moteur (français) dans un détail repliable', () => {
  renderAlerts(accountView({ state: 'error', error_reason: 'other', error_detail: "Secret de l'app refusé", error_cause: 'credentials' }), vi.fn(), 'en');
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('The last verification of the account failed.');
  expect(alert).toHaveTextContent('Verify again; if this continues, replace the credentials.');
  expect(alert).not.toHaveTextContent('Reason:');
  const details = screen.getByText('Details from WABAGENT (in French)').closest('details');
  expect(details).not.toHaveAttribute('open');
  expect(details).toHaveTextContent("Secret de l'app refusé");
  const outside = alert.cloneNode(true) as HTMLElement;
  outside.querySelectorAll('details').forEach((d) => d.remove());
  expect(outside).not.toHaveTextContent("Secret de l'app");
  expect(screen.getByRole('button', { name: 'Replace credentials' })).toBeInTheDocument();
});

test('interface anglaise, cause « support » : phrase traduite seulement, aucun français et aucun détail', () => {
  renderAlerts(accountView({ state: 'error', error_reason: 'other', error_detail: CANNOT_CONNECT, error_cause: 'support' }), vi.fn(), 'en');
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('This account cannot be connected. Contact support.');
  expect(alert).not.toHaveTextContent('raccordé');
  expect(alert.querySelector('details')).toBeNull();
});

test('interface française : le motif du moteur reste en clair, sans détail replié', () => {
  renderAlerts(accountView({ state: 'error', error_reason: 'other', error_detail: "Secret de l'app refusé", error_cause: 'credentials' }), vi.fn());
  expect(screen.getByRole('alert')).toHaveTextContent("Motif : Secret de l'app refusé.");
  expect(screen.queryByText('Détail de WABAGENT (en français)')).not.toBeInTheDocument();
});

test('alertes du fournisseur : paiement, verrouillage, politique, mise à jour, chacune son texte', () => {
  renderAlerts(accountView({
    alerts: [
      { kind: 'payment', code: null, event: null, at: '2026-11-08T10:00:00.000Z' },
      { kind: 'account_locked', code: 131031, event: 'ACCOUNT_VIOLATION', at: '2026-11-08T10:00:00.000Z' },
      { kind: 'policy_block', code: null, event: null, at: '2026-11-08T10:00:00.000Z' },
      { kind: 'account_update', code: null, event: null, at: '2026-11-08T10:00:00.000Z' },
    ],
  }));
  expect(screen.getByText('Meta signale un problème de paiement sur ce compte.')).toBeInTheDocument();
  expect(screen.getByText('Meta a verrouillé ce compte.')).toBeInTheDocument();
  expect(screen.getByText('Meta bloque ce compte pour non-respect de sa politique.')).toBeInTheDocument();
  expect(screen.getByText('Meta a mis à jour ce compte.')).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: 'Ouvrir WhatsApp Manager ↗' })[0]).toHaveAttribute(
    'href',
    'https://business.facebook.com/wa/manage/phone-numbers/?waba_id=104829371625544',
  );
});

test('alerte du fournisseur sur un compte CM.com : nomme CM.com, aucun lien vers WhatsApp Manager', () => {
  renderAlerts(accountView({ mode: 'cm_com', waba_id: null, alerts: [{ kind: 'payment', code: null, event: null, at: '2026-11-08T10:00:00.000Z' }] }));
  expect(screen.getByText('CM.com signale un problème de paiement sur ce compte.')).toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

test('qualité dégradée : nomme le numéro concerné ; numéro inconnu du compte : rien', () => {
  const account = accountView({
    numbers: [numberView({ id: 7, phone_e164: '+33612457890', quality: 'RED' })],
    alerts: [{ kind: 'quality_degraded', number_id: 7 }, { kind: 'quality_degraded', number_id: 99 }],
  });
  renderAlerts(account);
  expect(screen.getAllByText(/La qualité du numéro/)).toHaveLength(1);
  expect(screen.getByText('La qualité du numéro +33 6 12 45 78 90 est basse.')).toBeInTheDocument();
});

test('numéro de test Meta : limite des destinataires et lien vers Meta', () => {
  renderAlerts(accountView({ numbers: [numberView({ is_test: true })] }));
  expect(screen.getByText(/seuls les destinataires déclarés dans votre app Meta \(5 au plus\)/)).toBeInTheDocument();
  const link = screen.getByRole('link', { name: 'Gérer les destinataires dans Meta ↗' });
  expect(link).toHaveAttribute('href', 'https://developers.facebook.com/apps/1424483510748297/');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
});

test('numéro de test sans identifiant d\'app connu : repli sur la liste des apps Meta', () => {
  renderAlerts(accountView({ numbers: [numberView({ is_test: true })], meta_app_id: null }));
  expect(screen.getByRole('link', { name: 'Gérer les destinataires dans Meta ↗' })).toHaveAttribute('href', 'https://developers.facebook.com/apps/');
});

test('un seul numéro de test parmi d\'autres : le bandeau s\'affiche, une seule fois', () => {
  renderAlerts(accountView({
    numbers: [numberView({ id: 1 }), numberView({ id: 2, is_test: true }), numberView({ id: 3, is_test: true })],
  }));
  expect(screen.getAllByText('Numéro de test Meta :')).toHaveLength(1);
});

test('numéro de test retiré du fournisseur, ou compte CM.com : pas de bandeau de test Meta', () => {
  const { unmount } = renderAlerts(accountView({ numbers: [numberView({ is_test: true, provider_state: 'removed' })] }));
  expect(screen.queryByText('Numéro de test Meta :')).not.toBeInTheDocument();
  unmount();
  renderAlerts(accountView({ mode: 'cm_com', waba_id: null, numbers: [numberView({ is_test: true })] }));
  expect(screen.queryByText('Numéro de test Meta :')).not.toBeInTheDocument();
});

test('aucun numéro de test : pas de bandeau, même si le compte porte l\'indicateur', () => {
  renderAlerts(accountView({ is_test: true, numbers: [numberView({ is_test: false })] }));
  expect(screen.queryByText('Numéro de test Meta :')).not.toBeInTheDocument();
});

test('aucune alerte : rien n\'est rendu', () => {
  const { container } = renderAlerts(accountView());
  expect(container).toBeEmptyDOMElement();
});

// recette 3.6 : « Vérifier maintenant » dans le bandeau d'erreur, pour chaque cause, qui ouvre la vérification
test('bandeau d\'erreur : bouton « Vérifier maintenant » pour chaque cause et chaque motif, qui appelle onVerify', async () => {
  const cases: Array<Partial<WhatsAppAccountView>> = [
    { error_reason: 'token_invalid' },
    { error_reason: 'signature_rejected' },
    { error_reason: 'other', error_detail: CANNOT_CONNECT, error_cause: 'support' },
    { error_reason: 'other', error_detail: "Secret de l'app refusé", error_cause: 'credentials' },
    { error_reason: 'other', error_detail: 'Identifiants enregistrés illisibles', error_cause: 'reconnect' },
    { error_reason: 'other', error_detail: null, error_cause: null },
  ];
  for (const over of cases) {
    const verify = vi.fn();
    const { unmount } = renderAlerts(accountView({ state: 'error', ...over }), vi.fn(), 'fr', verify);
    const alert = screen.getByRole('alert');
    await userEvent.click(within(alert).getByRole('button', { name: 'Vérifier maintenant' }));
    expect(verify).toHaveBeenCalledTimes(1);
    unmount();
  }
});

// recette 3.6 : les causes « support » et « reconnect » gardent leur conseil
test('bandeau d\'erreur : « support » et « reconnect » gardent leur conseil, sans « si cela continue »', () => {
  const { unmount } = renderAlerts(accountView({ state: 'error', error_reason: 'other', error_detail: CANNOT_CONNECT, error_cause: 'support' }), vi.fn(), 'fr', vi.fn());
  expect(screen.getByRole('alert')).toHaveTextContent(/Contactez le support\.\s*Vérifier maintenant$/);
  expect(screen.getByRole('alert')).not.toHaveTextContent('si cela continue');
  unmount();
  renderAlerts(accountView({ state: 'error', error_reason: 'other', error_detail: 'Identifiants enregistrés illisibles', error_cause: 'reconnect' }), vi.fn(), 'fr', vi.fn());
  expect(screen.getByRole('alert')).toHaveTextContent(/Retirez le compte puis raccordez-le de nouveau\.\s*Vérifier maintenant$/);
  expect(screen.getByRole('alert')).not.toHaveTextContent('si cela continue');
  expect(screen.queryByRole('button', { name: 'Remplacer les identifiants' })).not.toBeInTheDocument();
});

// recette 3.6, Ruling C-12 : le texte s'adoucit, le ton du bandeau reste celui d'un danger
test('bandeau d\'erreur : ton danger inchangé, « Vérifier maintenant » puis « Remplacer les identifiants »', () => {
  renderAlerts(accountView({ state: 'error', error_reason: 'token_invalid' }), vi.fn(), 'fr', vi.fn());
  const alert = screen.getByRole('alert');
  expect(alert).toHaveClass('bg-danger-soft', 'text-danger-ink');
  expect(within(alert).getAllByRole('button').map((b) => b.textContent)).toEqual(['Vérifier maintenant', 'Remplacer les identifiants']);
});

// recette 3.6 : sans fenêtre de vérification fournie, pas de bouton
test('bandeau d\'erreur sans onVerify : aucun bouton « Vérifier maintenant »', () => {
  renderAlerts(accountView({ state: 'error', error_reason: 'other', error_detail: null }), vi.fn());
  expect(screen.queryByRole('button', { name: 'Vérifier maintenant' })).not.toBeInTheDocument();
});

test('interface anglaise : bouton « Verify now » et texte de la cause inconnue', () => {
  renderAlerts(accountView({ state: 'error', error_reason: 'other', error_detail: null }), vi.fn(), 'en', vi.fn());
  expect(screen.getByRole('alert')).toHaveTextContent('The last verification of the account failed. Verify again to get the reason.');
  expect(within(screen.getByRole('alert')).getByRole('button', { name: 'Verify now' })).toBeInTheDocument();
});
