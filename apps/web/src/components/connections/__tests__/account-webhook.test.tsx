import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import { AccountWebhook } from '../account-webhook';
import { webhookView } from './fixtures';
import { engineError, json, renderIntl, stubFetch } from './helpers';

beforeEach(() => {
  vi.restoreAllMocks();
});

// revue 2b-3 M-2 : la boîte lit la route dédiée du compte, jamais la liste des comptes
test('lit GET /api/whatsapp-accounts/<id>/webhook et affiche l\'adresse et le jeton masqué', async () => {
  const calls = stubFetch(() => json(webhookView()));
  renderIntl(<AccountWebhook accountId={7} mode="meta_manual" refreshKey={1} />);
  expect(await screen.findByText('https://dev.wabagent.com/webhook/meta/cle-secrete-du-compte')).toBeInTheDocument();
  expect(screen.getByText('••••x7Pa')).toBeInTheDocument();
  expect(calls).toEqual([{ url: '/api/whatsapp-accounts/7/webhook', method: 'GET', body: undefined }]);
});

test('CM.com : adresse seule, pas de jeton', async () => {
  stubFetch(() => json(webhookView({ path: '/webhook/cm-com/cle', url: null, verify_token: null })));
  renderIntl(<AccountWebhook accountId={3} mode="cm_com" refreshKey={1} />);
  expect(await screen.findByText('/webhook/cm-com/cle')).toBeInTheDocument();
  expect(screen.queryByText('Jeton de vérification')).not.toBeInTheDocument();
});

test('pendant la lecture : indication de chargement, aucun secret', () => {
  stubFetch(() => new Promise<Response>(() => undefined));
  renderIntl(<AccountWebhook accountId={7} mode="meta_manual" refreshKey={1} />);
  expect(screen.getByText('Chargement du webhook…')).toBeInTheDocument();
  expect(screen.queryByText(/webhook\/meta/)).not.toBeInTheDocument();
});

test('lecture en échec : message et « Réessayer » qui relit la route', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  let attempt = 0;
  const calls = stubFetch(() => {
    attempt += 1;
    return attempt === 1 ? engineError(500, 'INTERNAL', 'Erreur interne.') : json(webhookView());
  });
  renderIntl(<AccountWebhook accountId={7} mode="meta_manual" refreshKey={1} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de lire le webhook du compte.');
  await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByText('https://dev.wabagent.com/webhook/meta/cle-secrete-du-compte')).toBeInTheDocument();
  expect(calls).toHaveLength(2);
});

test('réponse qui n\'est pas un webhook (liste de comptes, par exemple) : traitée comme un échec, rien n\'est affiché', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  stubFetch(() => json([{ id: 7 }]));
  renderIntl(<AccountWebhook accountId={7} mode="meta_manual" refreshKey={1} />);
  expect(await screen.findByRole('alert')).toBeInTheDocument();
});

test('compte déconnecté (webhook vide) : rien n\'est affiché', async () => {
  const calls = stubFetch(() => json({ path: '', url: null, verify_token: null }));
  const { container } = renderIntl(<AccountWebhook accountId={7} mode="meta_manual" refreshKey={1} />);
  await waitFor(() => expect(calls).toHaveLength(1));
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});

test('nouvelle clé de relecture : la route est relue et le jeton affiché suit, sans repasser par le chargement', async () => {
  let token = 'wab_vt_ancien0000000000001111';
  const calls = stubFetch(() => json(webhookView({ verify_token: token })));
  const { rerender } = renderIntl(<AccountWebhook accountId={7} mode="meta_manual" refreshKey={1} />);
  expect(await screen.findByText('••••1111')).toBeInTheDocument();
  token = 'wab_vt_nouveau000000002222';
  rerender(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <AccountWebhook accountId={7} mode="meta_manual" refreshKey={2} />
    </NextIntlClientProvider>,
  );
  expect(await screen.findByText('••••2222')).toBeInTheDocument();
  expect(screen.queryByText('Chargement du webhook…')).not.toBeInTheDocument();
  expect(calls).toHaveLength(2);
});
