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

/** Webhook d'un compte CM.com : la boîte n'existe plus que pour eux (spec R1 §6.2). */
const cm = (over: Partial<ReturnType<typeof webhookView>> = {}) =>
  webhookView({ path: '/webhook/cm-com/cle', url: 'https://dev.wabagent.com/webhook/cm-com/cle', ...over });

// revue 2b-3 M-2 : la boîte lit la route dédiée du compte, jamais la liste des comptes
test('lit GET /api/whatsapp-accounts/<id>/webhook et affiche l\'adresse', async () => {
  const calls = stubFetch(() => json(cm()));
  renderIntl(<AccountWebhook accountId={7} refreshKey={1} />);
  expect(await screen.findByText('https://dev.wabagent.com/webhook/cm-com/cle')).toBeInTheDocument();
  expect(calls).toEqual([{ url: '/api/whatsapp-accounts/7/webhook', method: 'GET', body: undefined }]);
});

test('sans adresse publique : le chemin seul, pas de jeton', async () => {
  stubFetch(() => json(cm({ url: null })));
  renderIntl(<AccountWebhook accountId={3} refreshKey={1} />);
  expect(await screen.findByText('/webhook/cm-com/cle')).toBeInTheDocument();
  expect(screen.queryByText('Jeton de vérification')).not.toBeInTheDocument();
});

test('pendant la lecture : indication de chargement, aucun secret', () => {
  stubFetch(() => new Promise<Response>(() => undefined));
  renderIntl(<AccountWebhook accountId={7} refreshKey={1} />);
  expect(screen.getByText('Chargement du webhook…')).toBeInTheDocument();
  expect(screen.queryByText(/webhook\/cm-com/)).not.toBeInTheDocument();
});

test('lecture en échec : message et « Réessayer » qui relit la route', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  let attempt = 0;
  const calls = stubFetch(() => {
    attempt += 1;
    return attempt === 1 ? engineError(500, 'INTERNAL', 'Erreur interne.') : json(cm());
  });
  renderIntl(<AccountWebhook accountId={7} refreshKey={1} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Impossible de lire le webhook du compte.');
  await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByText('https://dev.wabagent.com/webhook/cm-com/cle')).toBeInTheDocument();
  expect(calls).toHaveLength(2);
});

test('réponse qui n\'est pas un webhook (liste de comptes, par exemple) : traitée comme un échec, rien n\'est affiché', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  stubFetch(() => json([{ id: 7 }]));
  renderIntl(<AccountWebhook accountId={7} refreshKey={1} />);
  expect(await screen.findByRole('alert')).toBeInTheDocument();
});

test('compte déconnecté (webhook vide) : rien n\'est affiché', async () => {
  const calls = stubFetch(() => json({ path: '', url: null }));
  const { container } = renderIntl(<AccountWebhook accountId={7} refreshKey={1} />);
  await waitFor(() => expect(calls).toHaveLength(1));
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});

test('nouvelle clé de relecture : la route est relue et l\'adresse affichée suit, sans repasser par le chargement', async () => {
  let key = 'ancienne-cle';
  const calls = stubFetch(() => json(cm({ path: `/webhook/cm-com/${key}`, url: `https://dev.wabagent.com/webhook/cm-com/${key}` })));
  const { rerender } = renderIntl(<AccountWebhook accountId={7} refreshKey={1} />);
  expect(await screen.findByText('https://dev.wabagent.com/webhook/cm-com/ancienne-cle')).toBeInTheDocument();
  key = 'nouvelle-cle';
  rerender(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <AccountWebhook accountId={7} refreshKey={2} />
    </NextIntlClientProvider>,
  );
  expect(await screen.findByText('https://dev.wabagent.com/webhook/cm-com/nouvelle-cle')).toBeInTheDocument();
  expect(screen.queryByText('Chargement du webhook…')).not.toBeInTheDocument();
  expect(calls).toHaveLength(2);
});
