import { render, screen } from '@testing-library/react';
import { test, expect } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import { AccountAlerts } from '../account-alerts';
import { accountView, numberView } from './fixtures';
import type { WhatsAppAccountView } from '@wabagent/contracts';

const NOW = new Date('2026-11-09T10:00:00.000Z');

function renderAlerts(account: WhatsAppAccountView) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <AccountAlerts account={account} now={NOW} />
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

test('compte en erreur, autre motif ou motif absent : bandeau générique', () => {
  const { unmount } = renderAlerts(accountView({ state: 'error', error_reason: 'other' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Le compte est en erreur.');
  unmount();
  renderAlerts(accountView({ state: 'error', error_reason: null }));
  expect(screen.getByRole('alert')).toHaveTextContent('Le compte est en erreur.');
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

test('compte de test Meta : limite des destinataires et lien vers Meta', () => {
  renderAlerts(accountView({ is_test: true }));
  expect(screen.getByText(/seuls les destinataires déclarés dans votre app Meta \(5 au plus\)/)).toBeInTheDocument();
  const link = screen.getByRole('link', { name: 'Gérer les destinataires dans Meta ↗' });
  expect(link).toHaveAttribute('href', 'https://developers.facebook.com/apps/1424483510748297/');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
});

test('compte de test sans identifiant d\'app connu : repli sur la liste des apps Meta', () => {
  renderAlerts(accountView({ is_test: true, meta_app_id: null }));
  expect(screen.getByRole('link', { name: 'Gérer les destinataires dans Meta ↗' })).toHaveAttribute('href', 'https://developers.facebook.com/apps/');
});

test('aucune alerte : rien n\'est rendu', () => {
  const { container } = renderAlerts(accountView());
  expect(container).toBeEmptyDOMElement();
});
