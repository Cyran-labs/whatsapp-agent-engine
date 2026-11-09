import { screen, within } from '@testing-library/react';
import { test, expect } from 'vitest';
import type { WhatsAppVerificationCheck } from '@wabagent/contracts';
import { VerificationChecks, checksFromDetails } from '../verification-checks';
import { renderIntl } from './helpers';

test('une ligne par contrôle, libellé de la clé et état', () => {
  const checks: WhatsAppVerificationCheck[] = [
    { key: 'token', status: 'ok' },
    { key: 'app_secret', status: 'pending' },
    { key: 'subscription', status: 'created' },
    { key: 'waba_access', status: 'failed', detail: 'Accès refusé à la WABA' },
    { key: 'app', status: 'ok' },
  ];
  renderIntl(<VerificationChecks checks={checks} />);
  const items = within(screen.getByRole('list', { name: 'Contrôles de vérification' })).getAllByRole('listitem');
  expect(items).toHaveLength(5);
  expect(items[0]).toHaveTextContent("Jeton d'accès valide");
  expect(items[0]).toHaveTextContent('Réussi');
  expect(items[1]).toHaveTextContent("Secret de l'app Meta");
  expect(items[1]).toHaveTextContent('contrôlé au premier message reçu');
  expect(items[2]).toHaveTextContent('abonnement créé');
  expect(items[3]).toHaveTextContent('Accès au compte WhatsApp Business');
  expect(items[3]).toHaveTextContent('Accès refusé à la WABA');
  expect(items[3]).toHaveTextContent('Échec');
  expect(items[3].className).toMatch(/text-danger/);
  expect(items[4]).toHaveTextContent('Application du jeton lue chez Meta');
});

test('un contrôle en attente avec un détail du moteur affiche ce détail', () => {
  renderIntl(<VerificationChecks checks={[{ key: 'numbers', status: 'pending', detail: "Le fournisseur n'a renvoyé aucun numéro : rien n'a été retiré." }]} />);
  expect(screen.getByText(/rien n'a été retiré/)).toBeInTheDocument();
  expect(screen.queryByText('contrôlé au premier message reçu')).not.toBeInTheDocument();
});

test('checksFromDetails : chaque détail devient un contrôle en échec (clé = chemin) ; les chemins inconnus sont ignorés', () => {
  expect(
    checksFromDetails([
      { path: 'token', message: 'Jeton refusé' },
      { path: 'numbers', message: 'Aucun numéro' },
      { path: 'bots.x', message: 'Pas un contrôle' },
      { path: 'name' },
    ]),
  ).toEqual([
    { key: 'token', status: 'failed', detail: 'Jeton refusé' },
    { key: 'numbers', status: 'failed', detail: 'Aucun numéro' },
  ]);
});
