import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, test, expect, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import { WebhookBox } from '../webhook-box';
import type { WhatsAppWebhookView } from '@wabagent/contracts';

/** Boîte webhook d'un compte CM.com : la seule qui reste (spec R1 §6.2). */
const CM: WhatsAppWebhookView = {
  path: '/webhook/cm-com/cle-secrete',
  url: 'https://dev.wabagent.com/webhook/cm-com/cle-secrete',
};

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

function renderBox(webhook: WhatsAppWebhookView) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <WebhookBox webhook={webhook} />
    </NextIntlClientProvider>,
  );
}

// spec R1 §2 : aucune recopie manuelle en repli pour Meta ; la boîte ne montre jamais de jeton de vérification.
test('jamais de jeton de vérification ni de texte Meta, même si la réponse en portait un', () => {
  // Réponse d'un ancien moteur qui porterait encore un jeton : la boîte ne l'affiche jamais (revue R1 ISO-M5).
  const { container } = renderBox({ ...CM, verify_token: 'wab_vt_8Kq2abcdefghijx7Pa' } as WhatsAppWebhookView);
  expect(screen.getByText('À coller dans la configuration du webhook de votre app Channels de CM.com.')).toBeInTheDocument();
  expect(container.textContent).not.toMatch(/wab_vt_|x7Pa|Jeton de vérification|app Meta/);
  expect(screen.queryByRole('button', { name: 'Afficher' })).not.toBeInTheDocument();
});

test('« Copier » copie l\'adresse complète du webhook', async () => {
  renderBox(CM);
  expect(screen.getByText('https://dev.wabagent.com/webhook/cm-com/cle-secrete')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: "Copier l'adresse du webhook" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://dev.wabagent.com/webhook/cm-com/cle-secrete'));
  expect(await screen.findByText('Copié')).toBeInTheDocument();
});

test('copie refusée par le navigateur : « Copie impossible », rien de plus', async () => {
  writeText.mockRejectedValue(new Error('denied'));
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  renderBox(CM);
  fireEvent.click(screen.getByRole('button', { name: "Copier l'adresse du webhook" }));
  expect(await screen.findByText('Copie impossible')).toBeInTheDocument();
  expect(JSON.stringify(error.mock.calls)).not.toContain('cle-secrete');
  error.mockRestore();
});

test('adresse publique absente : le chemin et la mention, aucun bouton de copie de l\'adresse', () => {
  renderBox({ ...CM, url: null });
  expect(screen.getByText('/webhook/cm-com/cle-secrete')).toBeInTheDocument();
  expect(screen.getByText('Adresse publique du moteur non configurée')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: "Copier l'adresse du webhook" })).not.toBeInTheDocument();
});

test('compte déconnecté (chemin vide) : rien n\'est affiché', () => {
  const { container } = renderBox({ path: '', url: null });
  expect(container).toBeEmptyDOMElement();
});
