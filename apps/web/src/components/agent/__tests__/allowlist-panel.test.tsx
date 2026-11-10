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
// revue finale 2b-3 m-11 : la liste s'affiche avec formatPhone ; ce qui est envoyé au moteur reste en E.164
const SHOWN = ['+33 6 11 11 11 11', '+33 6 22 22 22 22'];

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
  expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(SHOWN);
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
  await userEvent.click(screen.getByRole('button', { name: 'Retirer +33 6 11 11 11 11' }));
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
  stubFetch(() => engineError(409, 'CONFLICT', 'La liste a changé, relisez la page.'));
  renderPanel();
  await userEvent.click(screen.getByRole('button', { name: 'Retirer +33 6 11 11 11 11' }));
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('La liste a changé, relisez la page.');
});

// tâche 15 : un refus du moteur ne reste pas affiché quand l'admin modifie la liste ou tape dans le champ
test('refus 409 du moteur : le message disparaît à la modification suivante (retrait, saisie, ajout)', async () => {
  stubFetch(() => engineError(409, 'CONFLICT', 'La liste a changé, relisez la page.'));
  renderPanel();
  const refuse = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La liste a changé, relisez la page.');
  };
  await userEvent.click(screen.getByRole('button', { name: 'Retirer +33 6 11 11 11 11' }));
  await refuse();
  await userEvent.type(screen.getByLabelText('Numéro à autoriser'), '+');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText('Numéro à autoriser'));
  await refuse();
  await userEvent.click(screen.getByRole('button', { name: 'Retirer +33 6 22 22 22 22' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

// recette Q-10 : le web n'interdit plus d'enregistrer une liste vide, le moteur est le juge
test('recette Q-10 : vider la liste puis « Enregistrer » envoie { entries: [] } et confirme', async () => {
  const calls = stubFetch(() => json({ allowlist: [] }));
  const { onChanged } = renderPanel();
  await userEvent.click(screen.getByRole('button', { name: 'Retirer +33 6 11 11 11 11' }));
  await userEvent.click(screen.getByRole('button', { name: 'Retirer +33 6 22 22 22 22' }));
  const save = screen.getByRole('button', { name: 'Enregistrer' });
  expect(save).toBeEnabled();
  await userEvent.click(save);
  expect(calls).toEqual([{ url: '/api/bots/b1/allowlist', method: 'PUT', body: { entries: [] } }]);
  expect(await screen.findByText('Liste enregistrée.')).toBeInTheDocument();
  expect(onChanged).toHaveBeenCalledTimes(1);
});

// recette Q-10 : le refus éventuel du moteur sur une liste vide reste affiché
test('recette Q-10 : si le moteur refuse tout de même la liste vide, son refus s\'affiche', async () => {
  stubFetch(() => engineError(409, 'CONFLICT', "Ajoutez au moins un numéro à la liste d'accès limité."));
  renderPanel();
  await userEvent.click(screen.getByRole('button', { name: 'Retirer +33 6 11 11 11 11' }));
  await userEvent.click(screen.getByRole('button', { name: 'Retirer +33 6 22 22 22 22' }));
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByRole('alert')).toHaveTextContent("Ajoutez au moins un numéro à la liste d'accès limité.");
});

// recette Q-10 : le texte du panneau dit ce que veut dire une liste vide
test('recette Q-10 : le texte du panneau dit qu\'une liste vide ne répond à personne', () => {
  renderPanel();
  expect(screen.getByText(/avec une liste vide, il ne répond à personne/)).toBeInTheDocument();
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
  expect(screen.getByText('+33 6 99 99 99 99')).toBeInTheDocument();
});

function renderChangeable(entries: string[]) {
  const onChanged = vi.fn();
  const tree = (list: string[]) => (
    <NextIntlClientProvider locale="fr" messages={messages}>
      <AllowlistPanel botId="b1" entries={list} canEdit onChanged={onChanged} />
    </NextIntlClientProvider>
  );
  const view = render(tree(entries));
  return { onChanged, rerenderWith: (list: string[]) => view.rerender(tree(list)) };
}

test('relecture de la page avec la même liste (nouveau tableau) : les modifications non enregistrées sont conservées', async () => {
  const { rerenderWith } = renderChangeable(ENTRIES);
  await addNumber('+33633333333');
  rerenderWith([...ENTRIES]);
  expect(screen.getAllByRole('listitem').map((li) => li.textContent?.replace('Retirer', ''))).toEqual([...SHOWN, '+33 6 33 33 33 33']);
  expect(screen.queryByText(/a changé dans le moteur/)).not.toBeInTheDocument();
});

test('la liste du moteur a changé pendant une modification non enregistrée : la saisie reste et le changement est dit', async () => {
  const { rerenderWith } = renderChangeable(ENTRIES);
  await addNumber('+33633333333');
  rerenderWith(['+33699999999']);
  expect(screen.getAllByRole('listitem')).toHaveLength(3);
  expect(screen.getByText('+33 6 33 33 33 33')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(/La liste a changé dans le moteur entre-temps/);
});

// revue 2b-3 : « la liste a changé » affiché à tort quand la réponse du PUT est illisible
test('PUT réussi (200) au corps illisible : « Liste enregistrée. », jamais « a changé », la page est relue', async () => {
  const calls = stubFetch(() => new Response('pas du JSON', { status: 200 }));
  const { onChanged, rerenderWith } = renderChangeable(ENTRIES);
  await userEvent.click(screen.getByRole('button', { name: 'Retirer +33 6 11 11 11 11' }));
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('Liste enregistrée.')).toBeInTheDocument();
  expect(calls).toHaveLength(1);
  // la relecture de la page (déclenchée par onChanged) apporte la liste du moteur
  expect(onChanged).toHaveBeenCalledTimes(1);
  rerenderWith(['+33622222222']);
  expect(screen.queryByText(/a changé/)).not.toBeInTheDocument();
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
  expect(screen.getByText('Liste enregistrée.')).toBeInTheDocument();
});

test('enregistrement réussi : la liste normalisée par le moteur remplace la liste locale', async () => {
  stubFetch(() => json({ allowlist: ['+33622222222'] }));
  renderPanel();
  await userEvent.click(screen.getByRole('button', { name: 'Retirer +33 6 11 11 11 11' }));
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('Liste enregistrée.')).toBeInTheDocument();
  expect(screen.getAllByRole('listitem')).toHaveLength(1);
});

// revue finale 2b-3 (contraste)
test('contraste : la raison de « Enregistrer » désactivé est en text-muted', () => {
  renderPanel();
  const save = screen.getByRole('button', { name: 'Enregistrer' });
  expect(save).toBeDisabled();
  const reason = document.getElementById(save.getAttribute('aria-describedby') ?? '');
  expect(reason).not.toBeNull();
  expect(reason!.classList.contains('text-muted') && !reason!.classList.contains('text-muted-2')).toBe(true);
});
