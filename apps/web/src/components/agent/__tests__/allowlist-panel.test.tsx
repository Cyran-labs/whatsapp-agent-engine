import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import messages from '../../../../messages/fr.json';
import { AllowlistPanel } from '../allowlist-panel';
import { engineError, json, renderIntl, stubFetch } from '@/components/connections/__tests__/helpers';

beforeEach(() => {
  vi.restoreAllMocks();
});

const ENTRIES = ['+33611111111', '+33622222222'];

function renderPanel(canEdit = true, entries = ENTRIES) {
  const onChanged = vi.fn();
  renderIntl(<AllowlistPanel botId="b1" entries={entries} canEdit={canEdit} onChanged={onChanged} />);
  return { onChanged };
}

async function addNumber(value: string) {
  await userEvent.type(screen.getByLabelText('Numéro à autoriser'), value);
  await userEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
}

test('rappelle que la liste sert aussi au mot-clé « reset »', () => {
  renderPanel();
  expect(screen.getByText(/mot-clé « reset »/)).toBeInTheDocument();
});

test('membre : la liste en entier en lecture, ni champ ni bouton', () => {
  renderPanel(false);
  const list = screen.getByRole('list', { name: "Numéros de la liste d'accès limité" });
  expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(ENTRIES);
  expect(screen.queryByLabelText('Numéro à autoriser')).not.toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('membre, liste vide : le dit', () => {
  renderPanel(false, []);
  expect(screen.getByText('Aucun numéro dans la liste.')).toBeInTheDocument();
});

test('admin : « Enregistrer » est indisponible sans modification, avec sa raison', () => {
  renderPanel();
  const save = screen.getByRole('button', { name: 'Enregistrer' });
  expect(save).toBeDisabled();
  expect(save).toHaveAccessibleDescription('Aucune modification à enregistrer.');
});

test('admin : ajouter un numéro puis « Enregistrer » envoie PUT /allowlist avec { entries } et relit la page', async () => {
  const calls = stubFetch(() => json({}));
  const { onChanged } = renderPanel();
  await addNumber('+33633333333');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(calls).toEqual([{ url: '/api/bots/b1/allowlist', method: 'PUT', body: { entries: [...ENTRIES, '+33633333333'] } }]);
  expect(onChanged).toHaveBeenCalledTimes(1);
  expect(await screen.findByText('Liste enregistrée.')).toBeInTheDocument();
});

test('admin : retirer un numéro puis enregistrer', async () => {
  const calls = stubFetch(() => json({}));
  renderPanel();
  await userEvent.click(screen.getByRole('button', { name: 'Retirer +33611111111' }));
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(calls[0]?.body).toEqual({ entries: ['+33622222222'] });
});

// point d'attention 4 de la revue : une entrée refusée s'affiche sous sa ligne, les autres restent
test('entrée refusée par le moteur (entries.1) : message sous la deuxième ligne, les autres lignes intactes', async () => {
  stubFetch(() => engineError(422, 'VALIDATION_ERROR', 'Requête invalide.', [
    { path: 'entries.1', message: 'Numéro au format international (ex. +33612345678) ou identifiant WhatsApp attendu.' },
  ]));
  renderPanel();
  await addNumber('+33633333333');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  const rows = within(screen.getByRole('list', { name: 'Numéros autorisés' })).getAllByRole('listitem');
  expect(rows).toHaveLength(3);
  expect(within(rows[1]!).getByRole('alert')).toHaveTextContent(/format international/);
  expect(within(rows[0]!).queryByRole('alert')).not.toBeInTheDocument();
  expect(within(rows[2]!).queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByText('Liste enregistrée.')).not.toBeInTheDocument();
});

test('refus 409 du moteur sans détail par ligne : message général', async () => {
  stubFetch(() => engineError(409, 'CONFLICT', "Ajoutez au moins un numéro à la liste d'accès limité."));
  renderPanel();
  await userEvent.click(screen.getByRole('button', { name: 'Retirer +33611111111' }));
  await userEvent.click(screen.getByRole('button', { name: 'Retirer +33622222222' }));
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByRole('alert')).toHaveTextContent("Ajoutez au moins un numéro à la liste d'accès limité.");
});

test('organisation changée (409 ORG_CHANGED) : aucun message, aucune relecture', async () => {
  stubFetch(() => engineError(409, 'ORG_CHANGED', 'Organisation changée.'));
  const { onChanged } = renderPanel();
  await addNumber('+33633333333');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await Promise.resolve();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(onChanged).not.toHaveBeenCalled();
});

test('saisie pas encore ajoutée : « Enregistrer » indisponible, la raison est dite', async () => {
  renderPanel();
  await addNumber('+33633333333');
  await userEvent.type(screen.getByLabelText('Numéro à autoriser'), '+33644444444');
  const save = screen.getByRole('button', { name: 'Enregistrer' });
  expect(save).toBeDisabled();
  expect(save).toHaveAccessibleDescription(/Ajoutez le numéro saisi/);
});

test('la liste relue après enregistrement remplace la liste locale (le moteur normalise et fusionne)', () => {
  const onChanged = vi.fn();
  const tree = (entries: string[]) => (
    <NextIntlClientProvider locale="fr" messages={messages}>
      <AllowlistPanel botId="b1" entries={entries} canEdit onChanged={onChanged} />
    </NextIntlClientProvider>
  );
  const { rerender } = render(tree(ENTRIES));
  expect(screen.getAllByRole('listitem')).toHaveLength(2);
  rerender(tree(['+33699999999']));
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
  expect(screen.getByText('+33699999999')).toBeInTheDocument();
});
