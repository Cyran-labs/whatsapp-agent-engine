import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  renderIntl(<SimulateChat botId="b1" agentName="Support technique" />);
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
  renderIntl(<SimulateChat botId="b1" agentName="Support technique" />);
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
  renderIntl(<SimulateChat botId="b1" agentName="Support technique" />);
  await send('Salut');
  expect(await screen.findByRole('alert')).toHaveTextContent("Cet agent IA n'existe plus.");
  expect(screen.getByText('Non envoyé')).toBeInTheDocument();
});

// audit R-9
test('réseau coupé : bulle en échec, message de connexion, texte conservé', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
  renderIntl(<SimulateChat botId="b1" agentName="Support technique" />);
  await send('Salut');
  expect(await screen.findByText('Non envoyé')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Écrivez un message…')).toHaveValue('Salut');
});

test('texte déjà retapé pendant l\'envoi : le champ n\'est pas écrasé', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  stubFetch(async () => { await gate; return engineError(500, 'INTERNAL', 'Erreur interne.'); });
  renderIntl(<SimulateChat botId="b1" agentName="Support technique" />);
  await send('Premier');
  await userEvent.type(screen.getByPlaceholderText('Écrivez un message…'), 'Second');
  release();
  expect(await screen.findByText('Non envoyé')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Écrivez un message…')).toHaveValue('Second');
  expect(screen.getByRole('button', { name: 'Renvoyer' })).toBeInTheDocument();
});

test('envoi réussi : la réponse s\'affiche, aucun marquage d\'échec', async () => {
  stubFetch(OK);
  renderIntl(<SimulateChat botId="b1" agentName="Support technique" />);
  await send('Salut');
  await waitFor(() => expect(screen.getByText('Bonjour, comment aider ?')).toBeInTheDocument());
  expect(screen.queryByText('Non envoyé')).not.toBeInTheDocument();
});

// tâche 15 : renvoyer le texte remis dans le champ (Entrée) réutilise la bulle « Non envoyé »
test('Entrée sur le texte remis dans le champ : la bulle en échec est réutilisée, pas de seconde bulle', async () => {
  let attempts = 0;
  const calls = stubFetch(() => (++attempts === 1 ? engineError(500, 'INTERNAL', 'Erreur interne.') : OK()));
  renderIntl(<SimulateChat botId="b1" agentName="Support technique" />);
  await send('Une question');
  expect(await screen.findByText('Non envoyé')).toBeInTheDocument();
  await userEvent.type(screen.getByPlaceholderText('Écrivez un message…'), '{Enter}');
  expect(await screen.findByText('Bonjour, comment aider ?')).toBeInTheDocument();
  expect(screen.getAllByText('Une question')).toHaveLength(1);
  expect(screen.queryByText('Non envoyé')).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText('Écrivez un message…')).toHaveValue('');
  expect(calls).toHaveLength(2);
});

// tâche 15 : texte modifié avant de renvoyer : c'est un nouveau message, la bulle en échec reste
test('texte modifié avant Entrée : nouvelle bulle, la bulle « Non envoyé » reste', async () => {
  let attempts = 0;
  stubFetch(() => (++attempts === 1 ? engineError(500, 'INTERNAL', 'Erreur interne.') : OK()));
  renderIntl(<SimulateChat botId="b1" agentName="Support technique" />);
  await send('Une question');
  await screen.findByText('Non envoyé');
  await userEvent.type(screen.getByPlaceholderText('Écrivez un message…'), ' précisée{Enter}');
  expect(await screen.findByText('Bonjour, comment aider ?')).toBeInTheDocument();
  expect(screen.getByText('Une question')).toBeInTheDocument();
  expect(screen.getByText('Une question précisée')).toBeInTheDocument();
  expect(screen.getByText('Non envoyé')).toBeInTheDocument();
});

// tâche 15 : l'agent IA n'existe plus, renvoyer n'a aucun sens
test('agent IA supprimé (404) : « Renvoyer » disparaît, l\'envoi est désactivé avec sa raison et n\'appelle plus le moteur', async () => {
  const calls = stubFetch(() => engineError(404, 'NOT_FOUND', 'Agent IA introuvable.'));
  renderIntl(<SimulateChat botId="b1" agentName="Support technique" />);
  await send('Salut');
  expect(await screen.findByText('Non envoyé')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Renvoyer' })).not.toBeInTheDocument();
  const sendButton = screen.getByRole('button', { name: 'Envoyer' });
  expect(sendButton).toBeDisabled();
  expect(sendButton).toHaveAccessibleDescription("Cet agent IA n'existe plus.");
  await userEvent.type(screen.getByPlaceholderText('Écrivez un message…'), '{Enter}');
  expect(calls).toHaveLength(1);
  expect(screen.getAllByText('Salut')).toHaveLength(1);
});

// tâche 15 : la réponse du moteur est un 200 au corps illisible : le message est parti
test('200 au corps illisible : la bulle dit « Réponse illisible », sans « Renvoyer » ni « Non envoyé », le champ reste vide', async () => {
  const calls = stubFetch(() => new Response('pas du JSON', { status: 200 }));
  renderIntl(<SimulateChat botId="b1" agentName="Support technique" />);
  await send('Salut');
  expect(await screen.findByText('Réponse illisible')).toBeInTheDocument();
  expect(screen.queryByText('Non envoyé')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Renvoyer' })).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Réponse du simulateur illisible');
  expect(screen.getByPlaceholderText('Écrivez un message…')).toHaveValue('');
  expect(calls).toHaveLength(1);
});

// recette 3.2 : bulle de l'agent IA en blanc fixe, illisible en thème sombre (texte clair sur blanc)
test('aucune couleur fixe dans le fil : ni bg-white ni couleur en dur', () => {
  const source = readFileSync(join(__dirname, '../simulate-chat.tsx'), 'utf8');
  expect(source).not.toMatch(/bg-white/);
  expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
});

// recette 3.2 : bulles sur les jetons du thème, lisibles dans les deux thèmes
test('bulles : agent IA sur --surface bordée, contact sur --accent-soft, texte --fg', async () => {
  stubFetch(OK);
  renderIntl(<SimulateChat botId="b1" agentName="Support technique" />);
  await send('Une question');
  // la réponse est un paragraphe dans la bulle (listes à puces, recette du 12 nov. 2026) : le style est celui de la bulle
  const reply = ((await screen.findByText('Bonjour, comment aider ?')).parentElement as HTMLElement).className;
  for (const c of ['bg-surface', 'text-fg', 'border', 'border-border']) expect(reply.split(' ')).toContain(c);
  const mine = screen.getByText('Une question').className.split(' ');
  expect(mine).toContain('bg-accent-soft');
  expect(mine).toContain('text-fg');
  // le champ prenait le fond gris par défaut du navigateur en sombre
  const field = screen.getByPlaceholderText('Écrivez un message…').className.split(' ');
  expect(field).toContain('bg-surface');
  expect(field).toContain('text-fg');
  // revue I-2 : placeholder en --muted (8,22:1 en clair, 9,41:1 en sombre), --muted-2 ne tenait que 2,99:1 en clair
  expect(field).toContain('placeholder:text-muted');
  expect(field).not.toContain('placeholder:text-muted-2');
});

// recette 3.2 (revue I-1) : bulle « Non envoyé » en --fg sur --danger-soft (1,04:1 en sombre), libellé text-danger sur le fil
test('échec : bulle et libellé « Non envoyé » en --danger-ink sur --danger-soft, lisibles dans les deux thèmes', async () => {
  stubFetch(() => engineError(500, 'INTERNAL', 'Erreur interne.'));
  renderIntl(<SimulateChat botId="b1" agentName="Support technique" />);
  await send('Une question');
  const label = (await screen.findByText('Non envoyé')).parentElement!.className.split(' ');
  expect(label).toContain('bg-danger-soft');
  expect(label).toContain('text-danger-ink');
  expect(label).not.toContain('text-danger');
  const bubble = screen.getByText('Une question').className.split(' ');
  expect(bubble).toContain('bg-danger-soft');
  expect(bubble).toContain('text-danger-ink');
  expect(bubble).not.toContain('text-fg');
});

// recette du 12 nov. 2026 (remarques du bilan) : liste à puces de l'agent IA affichée en liste, retours à la ligne
// gardés, aucun HTML interprété
test('réponse avec une liste à puces : liste, retours à la ligne gardés, HTML affiché en texte', async () => {
  stubFetch(() => json({ session_id: 's1', reply: 'Nos horaires :\n- lundi\n• mardi <b>matin</b>\nÀ bientôt\nL\'équipe', model: 'haiku' }));
  renderIntl(<SimulateChat botId="b1" agentName="Support technique" />);
  await send('Horaires ?');
  const list = await screen.findByRole('list');
  const items = list.querySelectorAll('li');
  expect([...items].map((li) => li.textContent)).toEqual(['lundi', 'mardi <b>matin</b>']);
  expect(list.querySelector('b')).toBeNull();
  const after = screen.getByText((_c, el) => el?.tagName === 'P' && el.textContent === 'À bientôt\nL\'équipe');
  expect(after.className).toMatch(/whitespace-pre-wrap/);
  expect(screen.getByText('Nos horaires :').tagName).toBe('P');
});
