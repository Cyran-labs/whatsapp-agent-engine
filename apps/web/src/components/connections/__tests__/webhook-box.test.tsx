import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, test, expect, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import { WebhookBox } from '../webhook-box';
import type { WhatsAppWebhookView } from '@wabagent/contracts';

const META: WhatsAppWebhookView = {
  path: '/webhook/meta/cle-secrete',
  url: 'https://dev.wabagent.com/webhook/meta/cle-secrete',
  verify_token: 'wab_vt_8Kq2abcdefghijx7Pa',
};

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

function renderBox(webhook: WhatsAppWebhookView, mode: 'meta_manual' | 'cm_com' = 'meta_manual') {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <WebhookBox webhook={webhook} mode={mode} />
    </NextIntlClientProvider>,
  );
}

test('jeton de vérification masqué (4 derniers caractères), affiché par « Afficher », remasqué par « Masquer »', () => {
  renderBox(META);
  expect(screen.getByText('••••x7Pa')).toBeInTheDocument();
  expect(screen.queryByText('wab_vt_8Kq2abcdefghijx7Pa')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Afficher' }));
  expect(screen.getByText('wab_vt_8Kq2abcdefghijx7Pa')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Masquer' }));
  expect(screen.getByText('••••x7Pa')).toBeInTheDocument();
});

test('« Copier » copie l\'adresse complète du webhook', async () => {
  renderBox(META);
  expect(screen.getByText('https://dev.wabagent.com/webhook/meta/cle-secrete')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: "Copier l'adresse du webhook" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://dev.wabagent.com/webhook/meta/cle-secrete'));
  expect(await screen.findByText('Copié')).toBeInTheDocument();
});

test('« Copier » du jeton copie le jeton entier, même masqué', async () => {
  renderBox(META);
  fireEvent.click(screen.getByRole('button', { name: 'Copier le jeton de vérification' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('wab_vt_8Kq2abcdefghijx7Pa'));
});

test('copie refusée par le navigateur : « Copie impossible », rien de plus', async () => {
  writeText.mockRejectedValue(new Error('denied'));
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  renderBox(META);
  fireEvent.click(screen.getByRole('button', { name: "Copier l'adresse du webhook" }));
  expect(await screen.findByText('Copie impossible')).toBeInTheDocument();
  expect(JSON.stringify(error.mock.calls)).not.toContain('cle-secrete');
  error.mockRestore();
});

test('adresse publique absente : le chemin et la mention, aucun bouton de copie de l\'adresse', () => {
  renderBox({ ...META, url: null });
  expect(screen.getByText('/webhook/meta/cle-secrete')).toBeInTheDocument();
  expect(screen.getByText('Adresse publique du moteur non configurée')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: "Copier l'adresse du webhook" })).not.toBeInTheDocument();
});

test('CM.com : l\'adresse seule, pas de jeton de vérification', () => {
  renderBox({ path: '/webhook/cm-com/cle', url: 'https://dev.wabagent.com/webhook/cm-com/cle', verify_token: null }, 'cm_com');
  expect(screen.getByText('https://dev.wabagent.com/webhook/cm-com/cle')).toBeInTheDocument();
  expect(screen.queryByText('Jeton de vérification')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Afficher' })).not.toBeInTheDocument();
});
