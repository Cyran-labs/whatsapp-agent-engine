import { screen, within } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
import type { WhatsAppVerificationCheck } from '@wabagent/contracts';
import { VerificationChecks, checksFromDetails, refusedFieldsFromChecks } from '../verification-checks';
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

// revue finale 2b-3 m-12 : un contrôle inconnu du web (nouveau contrôle du moteur) s'affiche, il n'est pas perdu
test('checksFromDetails : chaque détail devient un contrôle en échec (clé = chemin), un contrôle inconnu compris', () => {
  expect(
    checksFromDetails([
      { path: 'token', message: 'Jeton refusé' },
      { path: 'numbers', message: 'Aucun numéro' },
      { path: 'quota_check', message: 'Quota dépassé' },
      { path: 'sans_message' },
    ]),
  ).toEqual([
    { key: 'token', status: 'failed', detail: 'Jeton refusé' },
    { key: 'numbers', status: 'failed', detail: 'Aucun numéro' },
    { key: 'quota_check', status: 'failed', detail: 'Quota dépassé' },
    { key: 'sans_message', status: 'failed' },
  ]);
});

test('un contrôle inconnu reçu du moteur : ligne affichée avec sa clé brute, son état et son détail', () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  renderIntl(<VerificationChecks checks={[{ key: 'quota_check', status: 'failed', detail: 'Quota dépassé' }, { key: 'token', status: 'ok' }]} />);
  const items = within(screen.getByRole('list', { name: 'Contrôles de vérification' })).getAllByRole('listitem');
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent('quota_check');
  expect(items[0]).toHaveTextContent('Quota dépassé');
  expect(items[0]).toHaveTextContent('Échec');
  expect(items[0]).not.toHaveTextContent('connections.checks');
  expect(items[1]).toHaveTextContent("Jeton d'accès valide");
  // aucune clé de message manquante n'est demandée à next-intl
  expect(logged).not.toHaveBeenCalled();
});

test('les clés connues viennent des contrats : chacune a son libellé dans les deux langues', async () => {
  const { VERIFICATION_CHECK_KEYS } = await import('@wabagent/contracts');
  const fr = (await import('../../../../messages/fr.json')).default.connections.checks.keys as Record<string, string>;
  const en = (await import('../../../../messages/en.json')).default.connections.checks.keys as Record<string, string>;
  expect(Object.keys(fr).sort()).toEqual([...VERIFICATION_CHECK_KEYS].sort());
  expect(Object.keys(en).sort()).toEqual([...VERIFICATION_CHECK_KEYS].sort());
});

// audit R-21 : seul provider_text, écrit par le moteur à partir du message du fournisseur, déclenche le détail repliable
test('provider_text : phrase traduite dans la ligne, texte du fournisseur dans un détail repliable fermé', () => {
  renderIntl(<VerificationChecks checks={[{ key: 'subscription', status: 'failed', detail: 'Meta a renvoyé une erreur', provider_text: '(#200) Permissions error' }]} />);
  const item = screen.getByRole('listitem');
  expect(item).toHaveTextContent("Abonnement de l'app aux webhooks du compte");
  expect(item).toHaveTextContent('Le fournisseur a refusé ce contrôle.');
  const details = within(item).getByText('Texte renvoyé par le fournisseur').closest('details');
  expect(details).not.toBeNull();
  expect(details).not.toHaveAttribute('open');
  expect(details).toHaveTextContent('(#200) Permissions error');
  const outside = item.cloneNode(true) as HTMLElement;
  outside.querySelector('details')?.remove();
  expect(outside).not.toHaveTextContent('Permissions error');
});

// audit R-21
test('sans provider_text : le texte du moteur s\'affiche tel quel, aucun détail repliable (même s\'il commence par « Meta : »)', () => {
  renderIntl(<VerificationChecks checks={[{ key: 'waba_access', status: 'failed', detail: 'Meta : Réponse de Meta illisible' }]} />);
  expect(screen.getByText('Meta : Réponse de Meta illisible')).toBeInTheDocument();
  expect(screen.queryByText('Texte renvoyé par le fournisseur')).not.toBeInTheDocument();
});

// audit R-21
test('checksFromDetails : le provider_text du détail devient celui du contrôle', () => {
  expect(checksFromDetails([{ path: 'subscription', message: 'Meta a renvoyé une erreur', provider_text: '(#200) Permissions error' }, { path: 'token' }]))
    .toEqual([
      { key: 'subscription', status: 'failed', detail: 'Meta a renvoyé une erreur', provider_text: '(#200) Permissions error' },
      { key: 'token', status: 'failed' },
    ]);
});

// revue finale M-4 : jamais le français du moteur en clair dans l'interface anglaise (même règle qu'AccountErrorSentence)
describe('interface anglaise', () => {
  const textOutsideDetails = (el: HTMLElement): string => {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('details').forEach((d) => d.remove());
    return clone.textContent ?? '';
  };

  test('contrôle en échec avec un détail du moteur : libellé et statut en anglais, détail français replié et fermé', () => {
    renderIntl(<VerificationChecks checks={[{ key: 'app_secret', status: 'failed', detail: "Secret de l'app refusé" }]} />, 'en');
    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent('Meta app secret');
    expect(textOutsideDetails(item)).toContain('Failed');
    expect(textOutsideDetails(item)).not.toContain("Secret de l'app refusé");
    const details = within(item).getByText('Details from WABAGENT (in French)').closest('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(details).toHaveTextContent("Secret de l'app refusé");
  });

  test('contrôle en attente avec un détail du moteur (inventaire vide) : statut « Pending » visible, détail replié', () => {
    renderIntl(<VerificationChecks checks={[{ key: 'numbers', status: 'pending', detail: "Le fournisseur n'a renvoyé aucun numéro : rien n'a été retiré." }]} />, 'en');
    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent('Account numbers');
    expect(textOutsideDetails(item)).toContain('Pending');
    expect(textOutsideDetails(item)).not.toContain('rien');
    expect(within(item).getByText('Details from WABAGENT (in French)').closest('details')).toHaveTextContent("rien n'a été retiré");
  });

  test('sans détail du moteur : notes traduites, aucun détail replié ; avec provider_text : le motif du moteur n\'apparaît pas', () => {
    renderIntl(<VerificationChecks checks={[
      { key: 'app_secret', status: 'pending' },
      { key: 'subscription', status: 'failed', detail: 'Meta a renvoyé une erreur', provider_text: '(#200) Permissions error' },
    ]} />, 'en');
    const [pending, refused] = screen.getAllByRole('listitem');
    expect(pending).toHaveTextContent('checked on the first message received');
    expect(pending!.querySelector('details')).toBeNull();
    expect(refused).toHaveTextContent('The provider refused this check.');
    expect(refused).not.toHaveTextContent('Meta a renvoyé une erreur');
  });

  // Témoin : en français le même détail est en clair, hors de tout détail replié.
  test('témoin : en français le détail du moteur reste en clair', () => {
    renderIntl(<VerificationChecks checks={[{ key: 'app_secret', status: 'failed', detail: "Secret de l'app refusé" }]} />);
    const item = screen.getByRole('listitem');
    expect(textOutsideDetails(item)).toContain("Secret de l'app refusé");
    expect(item.querySelector('details')).toBeNull();
  });
});

// audit décisions A19, revue de la tâche 19 : seules les clés de contrôle du moteur désignent un champ
test('refusedFieldsFromChecks : token vers access_token, app_secret vers app_secret, dans l\'ordre de l\'écran ; une clé hors contrôles ne marque rien', () => {
  const shown = ['waba_id', 'access_token', 'app_secret'] as const;
  expect(refusedFieldsFromChecks([{ path: 'app_secret' }, { path: 'token' }, { path: 'waba_access' }], shown)).toEqual(['access_token', 'app_secret']);
  expect(refusedFieldsFromChecks([{ path: 'access_token' }], shown)).toEqual([]);
  expect(refusedFieldsFromChecks([{ path: 'token' }], ['name', 'account_id', 'product_token'] as const)).toEqual([]);
});
