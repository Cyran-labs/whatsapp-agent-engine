import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { test, expect, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import { AccountAlerts } from '../account-alerts';
import { accountView, numberView } from './fixtures';
import type { WhatsAppAccountView } from '@wabagent/contracts';

const NOW = new Date('2026-11-09T10:00:00.000Z');

const CANNOT_CONNECT = 'Ce compte ne peut pas être raccordé. Contactez le support.';

function renderAlerts(account: WhatsAppAccountView, onReplaceCredentials?: () => void) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <AccountAlerts account={account} now={NOW} onReplaceCredentials={onReplaceCredentials} />
    </NextIntlClientProvider>,
  );
}

test('jeton qui expire : « 12 jours » et la marche à suivre', () => {
  renderAlerts(accountView({ alerts: [{ kind: 'token_expiring', at: '2026-11-21T10:00:00.000Z' }] }));
  expect(screen.getByText('Le jeton expire dans 12 jours.')).toBeInTheDocument();
  expect(screen.getByText(/jeton d'utilisateur système sans expiration/)).toBeInTheDocument();
  // Le menu du compte existe : le bandeau nomme l'action.
  expect(screen.getByText(/« Remplacer les identifiants »/)).toBeInTheDocument();
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
  expect(screen.getByRole('alert')).toHaveTextContent('Jeton refusé par Meta.');
  expect(screen.getByRole('alert')).toHaveTextContent('remplacez les identifiants du compte');
});

test('compte en erreur, jeton refusé sur CM.com : nomme le productToken et CM.com, jamais Meta', () => {
  renderAlerts(accountView({ mode: 'cm_com', waba_id: null, meta_app_id: null, state: 'error', error_reason: 'token_invalid' }));
  expect(screen.getByRole('alert')).toHaveTextContent('productToken refusé par CM.com.');
  expect(screen.getByRole('alert')).toHaveTextContent('remplacez les identifiants du compte');
  expect(screen.getByRole('alert')).not.toHaveTextContent('Meta');
});

test('compte en erreur, signature rejetée : bandeau du secret de l\'app', () => {
  renderAlerts(accountView({ state: 'error', error_reason: 'signature_rejected' }));
  expect(screen.getByRole('alert')).toHaveTextContent("Les messages reçus ne sont pas signés avec le secret de l'app");
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
test('erreur « autre » d\'un contrôle refusé (secret, WABA) : le motif en clair et « Remplacez les identifiants du compte » avec le bouton', async () => {
  const replace = vi.fn();
  renderAlerts(accountView({ state: 'error', error_reason: 'other', error_detail: "Secret de l'app refusé", error_cause: 'credentials' }), replace);
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent("Secret de l'app refusé");
  expect(alert).toHaveTextContent('Remplacez les identifiants du compte.');
  expect(alert).not.toHaveTextContent('reprise automatique');
  await userEvent.click(screen.getByRole('button', { name: 'Remplacer les identifiants' }));
  expect(replace).toHaveBeenCalledTimes(1);
});

// audit R-5
test('erreur « autre » due à une panne du fournisseur : seule cause qui garde « La vérification est reprise automatiquement »', () => {
  renderAlerts(accountView({ state: 'error', error_reason: 'other', error_detail: 'Meta ne répond pas', error_cause: 'provider' }), vi.fn());
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('Meta ne répond pas');
  expect(alert).toHaveTextContent('La vérification est reprise automatiquement');
  expect(screen.queryByRole('button', { name: 'Remplacer les identifiants' })).not.toBeInTheDocument();
});

// audit R-5 : la cause vient du moteur, jamais du texte du motif
test('le conseil suit error_cause et non le texte : un motif « Meta ne répond pas » en cause « credentials » demande de remplacer les identifiants, sans reprise automatique', () => {
  renderAlerts(accountView({ state: 'error', error_reason: 'other', error_detail: 'Meta ne répond pas', error_cause: 'credentials' }), vi.fn());
  expect(screen.getByRole('alert')).toHaveTextContent('Remplacez les identifiants du compte.');
  expect(screen.getByRole('alert')).not.toHaveTextContent('reprise automatique');
});

// audit R-5
test('le conseil suit error_cause et non le texte : le texte du moteur « Contactez le support » en cause « credentials » garde le bouton', () => {
  renderAlerts(accountView({ state: 'error', error_reason: 'other', error_detail: CANNOT_CONNECT, error_cause: 'credentials' }), vi.fn());
  expect(screen.getByRole('button', { name: 'Remplacer les identifiants' })).toBeInTheDocument();
});

// audit R-5
test('erreur sans motif connu (motif absent ou « autre » sans texte) : ne promet aucune reprise automatique', () => {
  const { unmount } = renderAlerts(accountView({ state: 'error', error_reason: 'other', error_detail: null }));
  expect(screen.getByRole('alert')).toHaveTextContent('Le compte est en erreur.');
  expect(screen.getByRole('alert')).not.toHaveTextContent('reprise automatique');
  unmount();
  renderAlerts(accountView({ state: 'error', error_reason: null, error_detail: null }));
  expect(screen.getByRole('alert')).toHaveTextContent('Le compte est en erreur.');
  expect(screen.getByRole('alert')).not.toHaveTextContent('reprise automatique');
});

// audit R-21
test('texte brut de Meta : dans un détail repliable fermé, la phrase du bandeau reste traduite', () => {
  renderAlerts(accountView({ state: 'error', error_reason: 'other', error_detail: 'Meta : (#100) Invalid parameter', error_cause: 'credentials' }), vi.fn());
  const summary = screen.getByText('Texte renvoyé par Meta');
  const details = summary.closest('details');
  expect(details).not.toBeNull();
  expect(details).not.toHaveAttribute('open');
  expect(details).toHaveTextContent('(#100) Invalid parameter');
  // hors du détail, ni le texte anglais ni le préfixe
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('Le compte est en erreur.');
  expect(alert).toHaveTextContent('Remplacez les identifiants du compte.');
  const outside = alert.cloneNode(true) as HTMLElement;
  outside.querySelector('details')?.remove();
  expect(outside).not.toHaveTextContent('Invalid parameter');
});

// audit R-21
test('jeton refusé avec un texte brut de Meta : même détail repliable', () => {
  renderAlerts(accountView({ state: 'error', error_reason: 'token_invalid', error_detail: 'Meta : Error validating access token' }));
  expect(screen.getByText('Texte renvoyé par Meta').closest('details')).toHaveTextContent('Error validating access token');
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
