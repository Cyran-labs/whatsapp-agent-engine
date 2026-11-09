import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { TRANSITION_MESSAGES } from '@wabagent/contracts';
import { StatusPanel } from '../status-panel';
import { botNumber, botView } from './fixtures';
import { engineError, json, renderIntl, stubFetch } from '@/components/connections/__tests__/helpers';

beforeEach(() => {
  vi.restoreAllMocks();
});

function renderPanel(bot = botView(), canEdit = true) {
  const onChanged = vi.fn();
  renderIntl(<StatusPanel bot={bot} canEdit={canEdit} onChanged={onChanged} />);
  return { onChanged };
}

test('admin, accès limité : ouvrir à tous, mettre en pause, revenir en brouillon', () => {
  renderPanel();
  expect(screen.getByText('Accès limité')).toBeInTheDocument();
  for (const name of ['Ouvrir à tous', 'Mettre en pause', 'Revenir en brouillon']) {
    expect(screen.getByRole('button', { name })).toBeEnabled();
  }
  expect(screen.queryByRole('button', { name: /Revenir en accès limité/ })).not.toBeInTheDocument();
});

test('admin, brouillon : « Ouvrir à tous » indisponible avec sa raison visible sous le bouton', () => {
  renderPanel(botView({ status: 'draft' }));
  expect(screen.getByRole('button', { name: 'Activer en accès limité' })).toBeEnabled();
  const open = screen.getByRole('button', { name: 'Ouvrir à tous' });
  expect(open).toBeDisabled();
  const reason = screen.getByText(TRANSITION_MESSAGES.not_from_draft);
  expect(reason).toBeVisible();
  expect(open).toHaveAccessibleDescription(TRANSITION_MESSAGES.not_from_draft);
});

test('brouillon sur un numéro de test : « Ouvrir à tous » permis', () => {
  renderPanel(botView({ status: 'draft', whatsapp_number: botNumber({ is_test: true }) }));
  expect(screen.getByRole('button', { name: 'Ouvrir à tous' })).toBeEnabled();
});

test('liste vide : l\'accès limité est indisponible avec la phrase du moteur', () => {
  renderPanel(botView({ status: 'paused', allowlist: [] }));
  const resume = screen.getByRole('button', { name: 'Reprendre en accès limité' });
  expect(resume).toBeDisabled();
  expect(resume).toHaveAccessibleDescription(TRANSITION_MESSAGES.empty_allowlist);
});

test('actif : « Revenir en accès limité »', () => {
  renderPanel(botView({ status: 'active' }));
  expect(screen.getByRole('button', { name: 'Revenir en accès limité' })).toBeEnabled();
});

test('compte du numéro en erreur : limited et active indisponibles, raison affichée', () => {
  renderPanel(botView({ status: 'paused', whatsapp_number: botNumber({ account_state: 'error' }) }));
  expect(screen.getByRole('button', { name: 'Reprendre en accès limité' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Ouvrir à tous' })).toBeDisabled();
  expect(screen.getAllByText(TRANSITION_MESSAGES.account_not_connected)).toHaveLength(2);
  expect(screen.getByRole('button', { name: 'Revenir en brouillon' })).toBeEnabled();
});

test('pause automatique pour numéro retiré : le motif est dit', () => {
  renderPanel(botView({ status: 'paused', status_reason: 'number_removed', whatsapp_number: botNumber({ present: false }) }));
  expect(screen.getByText('Mis en pause : le numéro a été retiré chez le fournisseur')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reprendre en accès limité' })).toBeDisabled();
});

test('« Mettre en pause » envoie PUT /status avec { status: "paused" } puis relit la page', async () => {
  const calls = stubFetch(() => json({}));
  const { onChanged } = renderPanel();
  await userEvent.click(screen.getByRole('button', { name: 'Mettre en pause' }));
  expect(calls).toEqual([{ url: '/api/bots/b1/status', method: 'PUT', body: { status: 'paused' } }]);
  expect(onChanged).toHaveBeenCalledTimes(1);
});

test('refus 409 du moteur : son message s\'affiche tel quel, la page est relue', async () => {
  stubFetch(() => engineError(409, 'CONFLICT', "Le compte WhatsApp de ce numéro n'est pas connecté."));
  const { onChanged } = renderPanel();
  await userEvent.click(screen.getByRole('button', { name: 'Ouvrir à tous' }));
  expect(await screen.findByRole('alert')).toHaveTextContent("Le compte WhatsApp de ce numéro n'est pas connecté.");
  expect(onChanged).toHaveBeenCalledTimes(1);
});

test('organisation changée dans un autre onglet (409 ORG_CHANGED) : rien n\'est affiché', async () => {
  stubFetch(() => engineError(409, 'ORG_CHANGED', 'Organisation changée.'));
  const { onChanged } = renderPanel();
  await userEvent.click(screen.getByRole('button', { name: 'Mettre en pause' }));
  await Promise.resolve();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(onChanged).not.toHaveBeenCalled();
});

test('panne réseau : message générique', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('réseau'); }));
  renderPanel();
  await userEvent.click(screen.getByRole('button', { name: 'Mettre en pause' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Changement de statut impossible, réessayez.');
});

test('membre non admin ou lecture seule : la pastille et le statut, aucun bouton', () => {
  renderPanel(botView(), false);
  expect(screen.getByText('Accès limité')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('compteur : N messages non servis et la date du dernier', () => {
  renderPanel(botView({ unserved: { count: 3, last_at: '2026-11-08T12:00:00.000Z' } }));
  expect(screen.getByText(/3 messages non servis, le dernier le .*nov\. 2026/)).toBeInTheDocument();
});

test('compteur : un seul message au singulier', () => {
  renderPanel(botView({ unserved: { count: 1, last_at: '2026-11-08T12:00:00.000Z' } }));
  expect(screen.getByText(/^1 message non servi, le dernier le /)).toBeInTheDocument();
});

test('compteur : aucun message non servi', () => {
  renderPanel();
  expect(screen.getByText('Aucun message non servi')).toBeInTheDocument();
});
