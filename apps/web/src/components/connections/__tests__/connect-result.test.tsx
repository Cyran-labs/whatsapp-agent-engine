import { screen, within } from '@testing-library/react';
import { vi, test, expect } from 'vitest';
import type { WhatsAppAccountCreated } from '@wabagent/contracts';
import { ConnectResult } from '../connect-result';
import { accountView, numberView, webhookView } from './fixtures';
import { renderIntl } from './helpers';

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

const noInventory = { added: 0, removed: 0, refused: 0, skipped_sandbox: 0, skipped_invalid: 0 };

function created(over: Partial<WhatsAppAccountCreated> = {}): WhatsAppAccountCreated {
  return {
    ...accountView({
      id: 7,
      name: 'Boutique principale',
      numbers: [
        numberView({ id: 1, phone_e164: '+33612457890', display_name: 'Boutique Marais' }),
        numberView({ id: 2, phone_e164: '+33184801234', display_name: 'Boutique SAV' }),
      ],
    }),
    // Lot R1 : le moteur inscrit lui-même le webhook d'un compte Meta, la réponse n'en porte pas.
    webhook: null,
    webhooks: { waba: 'ok', app: 'ok', app_host: null, checked_at: '2026-11-12T10:00:00.000Z' },
    checks: [
      { key: 'token', status: 'ok' },
      { key: 'waba_access', status: 'ok' },
      { key: 'subscription', status: 'created' },
      { key: 'app_secret', status: 'pending' },
      { key: 'token_expiry', status: 'ok', detail: 'Jeton sans expiration' },
      { key: 'webhook_waba', status: 'ok' },
      { key: 'webhook_app', status: 'ok' },
    ],
    inventory: { ...noInventory, added: 2 },
    ...over,
  };
}

test('contrôles de la vérification, dont l\'abonnement créé et le secret contrôlé au premier message', () => {
  renderIntl(<ConnectResult account={created()} />);
  expect(screen.getByRole('heading', { name: 'Compte raccordé' })).toBeInTheDocument();
  const list = screen.getByRole('list', { name: 'Contrôles de vérification' });
  expect(within(list).getByText('abonnement créé')).toBeInTheDocument();
  expect(within(list).getByText('contrôlé au premier message reçu')).toBeInTheDocument();
  expect(within(list).getByText('Jeton sans expiration')).toBeInTheDocument();
});

test('numéros trouvés : formatés, avec leur nom', () => {
  renderIntl(<ConnectResult account={created()} />);
  expect(screen.getByText('2 numéros trouvés')).toBeInTheDocument();
  const found = screen.getByRole('list', { name: 'Numéros trouvés' });
  expect(within(found).getByText('+33 6 12 45 78 90')).toBeInTheDocument();
  expect(within(found).getByText('Boutique Marais')).toBeInTheDocument();
  expect(within(found).getByText('+33 1 84 80 12 34')).toBeInTheDocument();
  expect(within(found).getByText('Boutique SAV')).toBeInTheDocument();
});

test('aucun numéro : le dit, sans liste', () => {
  renderIntl(<ConnectResult account={created({ numbers: [], inventory: noInventory })} />);
  expect(screen.getByText('Aucun numéro trouvé sur ce compte.')).toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Numéros trouvés' })).not.toBeInTheDocument();
});

test('numéros refusés : mention du bilan, absente quand il n\'y en a aucun', () => {
  const first = renderIntl(<ConnectResult account={created({ inventory: { ...noInventory, added: 1, refused: 2 } })} />);
  expect(screen.getByText('2 numéros déjà raccordés ailleurs, non ajoutés')).toBeInTheDocument();
  first.unmount();
  const second = renderIntl(<ConnectResult account={created({ inventory: { ...noInventory, added: 1, refused: 1 } })} />);
  expect(screen.getByText('1 numéro déjà raccordé ailleurs, non ajouté')).toBeInTheDocument();
  second.unmount();
  renderIntl(<ConnectResult account={created()} />);
  expect(screen.queryByText(/déjà raccordé/)).not.toBeInTheDocument();
});

test('un numéro retiré du fournisseur n\'est pas listé comme trouvé', () => {
  const account = created({
    numbers: [numberView({ id: 1 }), numberView({ id: 2, phone_e164: '+33184801234', display_name: 'Ancien', provider_state: 'removed' })],
  });
  renderIntl(<ConnectResult account={account} />);
  expect(screen.getByText('1 numéro trouvé')).toBeInTheDocument();
  expect(screen.queryByText('Ancien')).not.toBeInTheDocument();
});

// spec R1 §6.2 (revue tâche 1) : `webhook === null` pour Meta, aucune boîte à copier ni « Dernière étape ».
test('Meta : aucune boîte webhook ni jeton de vérification, rien à recopier chez Meta', () => {
  const { container } = renderIntl(<ConnectResult account={created()} />);
  expect(screen.queryByText('Adresse du webhook')).not.toBeInTheDocument();
  expect(screen.queryByText('Jeton de vérification')).not.toBeInTheDocument();
  expect(screen.queryByText(/Dernière étape/)).not.toBeInTheDocument();
  expect(container.textContent).not.toMatch(/cle-secrete-du-compte/);
});

// spec R1 §2 : aucune recopie manuelle en repli pour Meta, même si la réponse portait encore un webhook.
test('Meta avec un webhook non nul dans la réponse : aucune boîte affichée', () => {
  const { container } = renderIntl(<ConnectResult account={created({ webhook: webhookView() })} />);
  expect(screen.queryByText('Webhook du compte')).not.toBeInTheDocument();
  expect(screen.queryByText('Adresse du webhook')).not.toBeInTheDocument();
  expect(screen.queryByText(/Dernière étape/)).not.toBeInTheDocument();
  expect(container.textContent).not.toMatch(/cle-secrete-du-compte|x7Pa/);
});

test('Meta : les deux contrôles de webhook libellés, et l\'état des webhooks du compte', () => {
  renderIntl(<ConnectResult account={created()} />);
  const list = screen.getByRole('list', { name: 'Contrôles de vérification' });
  expect(within(list).getByText('Webhook de la WABA chez Meta')).toBeInTheDocument();
  expect(within(list).getByText("Webhook de l'app Meta")).toBeInTheDocument();
  expect(screen.getByText('Webhook inscrit chez Meta.')).toBeInTheDocument();
});

test('Meta : webhook de l\'app qui pointe ailleurs, la phrase est dite sans bouton dans le résultat', () => {
  renderIntl(<ConnectResult account={created({ webhooks: { waba: 'ok', app: 'elsewhere', app_host: 'autre.example.com', checked_at: null } })} />);
  expect(screen.getByText(/pointe vers autre\.example\.com/)).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('CM.com : adresse de rappel sans jeton de vérification', () => {
  const account = created({
    mode: 'cm_com',
    waba_id: null,
    meta_app_id: null,
    webhook: { path: '/webhook/cm-com/cle', url: 'https://dev.wabagent.com/webhook/cm-com/cle', verify_token: null },
    webhooks: null,
  });
  renderIntl(<ConnectResult account={account} />);
  expect(screen.getByText(/configuration du webhook de votre app Channels de CM\.com/)).toBeInTheDocument();
  expect(screen.getByText('https://dev.wabagent.com/webhook/cm-com/cle')).toBeInTheDocument();
  expect(screen.queryByText('Jeton de vérification')).not.toBeInTheDocument();
  expect(screen.getByText('Dernière étape chez CM.com')).toBeInTheDocument();
});

test('« Branchez-les ensuite sur vos agents IA. » et « Terminer » vers Connexions', () => {
  renderIntl(<ConnectResult account={created()} />);
  expect(screen.getByText('Branchez-les ensuite sur vos agents IA.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Terminer' })).toHaveAttribute('href', '/organisation/connexions');
});

test('le focus passe au titre du résultat (le formulaire a disparu)', () => {
  renderIntl(<ConnectResult account={created()} />);
  expect(screen.getByRole('heading', { name: 'Compte raccordé' })).toHaveFocus();
});
