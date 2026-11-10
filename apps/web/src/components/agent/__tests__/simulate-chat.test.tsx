import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { SimulateChat } from '../simulate-chat';
import { engineError, json, renderIntl, stubFetch } from '@/components/connections/__tests__/helpers';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

const OK = () => json({ session_id: 's1', reply: 'Bonjour, comment aider ?', model: 'haiku' });

async function send(text: string) {
  const field = screen.getByPlaceholderText('Écrivez un message…');
  await userEvent.type(field, text);
  await userEvent.keyboard('{Enter}');
}

// audit R-9
test('envoi en erreur serveur : la bulle est marquée « Non envoyé », le texte revient dans le champ, la référence est citée', async () => {
  stubFetch(() => json({ error: { code: 'INTERNAL', message: 'Erreur interne.', request_id: 'req-abc123' } }, 500));
  renderIntl(<SimulateChat botId="b1" />);
  await send('Bonjour, une question');
  expect(await screen.findByText('Non envoyé')).toBeInTheDocument();
  expect(screen.getByText('Bonjour, une question')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Écrivez un message…')).toHaveValue('Bonjour, une question');
  expect(screen.getByRole('alert')).toHaveTextContent('Référence : req-abc123');
  expect(screen.getByRole('button', { name: 'Renvoyer' })).toBeInTheDocument();
});

// audit R-9
test('« Renvoyer » envoie le même texte : la bulle n\'est plus en échec, la réponse arrive, le champ est vidé', async () => {
  let attempts = 0;
  const calls = stubFetch(() => (++attempts === 1 ? engineError(500, 'INTERNAL', 'Erreur interne.') : OK()));
  renderIntl(<SimulateChat botId="b1" />);
  await send('Une question');
  await userEvent.click(await screen.findByRole('button', { name: 'Renvoyer' }));
  expect(await screen.findByText('Bonjour, comment aider ?')).toBeInTheDocument();
  expect(screen.queryByText('Non envoyé')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText('Écrivez un message…')).toHaveValue('');
  expect(screen.getAllByText('Une question')).toHaveLength(1);
  expect(calls.map((c) => (c.body as { message: string }).message)).toEqual(['Une question', 'Une question']);
});

// audit R-9
test('agent IA supprimé (404) : « Cet agent IA n\'existe plus. », la bulle reste en échec', async () => {
  stubFetch(() => engineError(404, 'NOT_FOUND', 'Agent IA introuvable.'));
  renderIntl(<SimulateChat botId="b1" />);
  await send('Salut');
  expect(await screen.findByRole('alert')).toHaveTextContent("Cet agent IA n'existe plus.");
  expect(screen.getByText('Non envoyé')).toBeInTheDocument();
});

// audit R-9
test('réseau coupé : bulle en échec, message de connexion, texte conservé', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
  renderIntl(<SimulateChat botId="b1" />);
  await send('Salut');
  expect(await screen.findByText('Non envoyé')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Écrivez un message…')).toHaveValue('Salut');
});

test('texte déjà retapé pendant l\'envoi : le champ n\'est pas écrasé', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  stubFetch(async () => { await gate; return engineError(500, 'INTERNAL', 'Erreur interne.'); });
  renderIntl(<SimulateChat botId="b1" />);
  await send('Premier');
  await userEvent.type(screen.getByPlaceholderText('Écrivez un message…'), 'Second');
  release();
  expect(await screen.findByText('Non envoyé')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Écrivez un message…')).toHaveValue('Second');
  expect(screen.getByRole('button', { name: 'Renvoyer' })).toBeInTheDocument();
});

test('envoi réussi : la réponse s\'affiche, aucun marquage d\'échec', async () => {
  stubFetch(OK);
  renderIntl(<SimulateChat botId="b1" />);
  await send('Salut');
  await waitFor(() => expect(screen.getByText('Bonjour, comment aider ?')).toBeInTheDocument());
  expect(screen.queryByText('Non envoyé')).not.toBeInTheDocument();
});
