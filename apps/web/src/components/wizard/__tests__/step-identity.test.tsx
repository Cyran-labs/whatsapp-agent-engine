import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, test, expect } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import { Wizard } from '../wizard';

vi.mock('@/i18n/routing', () => ({ useRouter: () => ({ push: vi.fn() }), Link: (p: { children: React.ReactNode }) => p.children }));
beforeEach(() => vi.restoreAllMocks());

function entity(id: number, name: string, status: 'active' | 'archived' = 'active') {
  return { id, name, status, bots: 0, members: 0 };
}

const ONE = [entity(1, 'Siège')];
const THREE = [entity(1, 'Siège'), entity(5, 'Bordeaux'), entity(7, 'Lyon')];

/** Moque GET /api/entities ; renvoie le mock pour inspecter les appels. */
function mockEntities(list: unknown[] | 'fail') {
  const fn = vi.fn(async (url: string) => {
    if (url === '/api/entities') {
      return list === 'fail'
        ? new Response('{}', { status: 500 })
        : new Response(JSON.stringify(list), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function renderWizard(initialEntityId: number | null = null) {
  return render(<NextIntlClientProvider locale="fr" messages={messages}><Wizard initialEntityId={initialEntityId} /></NextIntlClientProvider>);
}

test('le nom genere le slug automatiquement', async () => {
  mockEntities(ONE);
  renderWizard();
  await userEvent.type(screen.getByLabelText('Nom de l\'agent IA'), 'Assistant Boutique');
  expect(screen.getByText(/assistant-boutique/)).toBeInTheDocument();
});

test('Continuer passe a l\'etape Personnalite', async () => {
  mockEntities(ONE);
  renderWizard();
  await userEvent.type(screen.getByLabelText('Nom de l\'agent IA'), 'Ventes');
  await waitFor(() => expect(screen.getByRole('button', { name: /Continuer/ })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: /Continuer/ }));
  expect(screen.getByText('La personnalité de votre agent IA')).toBeInTheDocument();
});

test('une seule entite active : pas de champ Entite, lead inchange', async () => {
  const fetchMock = mockEntities([...ONE, entity(9, 'Ancienne', 'archived')]);
  renderWizard();
  await userEvent.type(screen.getByLabelText('Nom de l\'agent IA'), 'Ventes');
  await waitFor(() => expect(screen.getByRole('button', { name: /Continuer/ })).toBeEnabled());
  expect(fetchMock).toHaveBeenCalledWith('/api/entities');
  expect(screen.queryByLabelText('Entité')).not.toBeInTheDocument();
  expect(screen.getByText(/son nom et les langues/)).toBeInTheDocument();
});

test('plusieurs entites : champ Entite sans preselection, Continuer bloque jusqu\'au choix', async () => {
  mockEntities([...THREE, entity(9, 'Ancienne', 'archived')]);
  renderWizard();
  const select = await screen.findByLabelText('Entité');
  expect(screen.getByText(/son nom, son entité et les langues/)).toBeInTheDocument();
  expect(screen.getByText(/Vous pourrez le déplacer depuis Organisation › Entités/)).toBeInTheDocument();
  expect(select).toHaveValue('');
  expect(screen.getByRole('option', { name: 'Choisir une entité' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Ancienne' })).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Nom de l\'agent IA'), 'Ventes');
  expect(screen.getByRole('button', { name: /Continuer/ })).toBeDisabled();
  await userEvent.selectOptions(select, 'Bordeaux');
  expect(screen.getByRole('button', { name: /Continuer/ })).toBeEnabled();
});

test('?entity=5 presélectionne l\'entite 5', async () => {
  mockEntities(THREE);
  renderWizard(5);
  const select = await screen.findByLabelText('Entité');
  await waitFor(() => expect(select).toHaveValue('5'));
});

test('?entity= qui n\'est pas une entite active est ignore', async () => {
  mockEntities([...THREE, entity(9, 'Ancienne', 'archived')]);
  renderWizard(9);
  const select = await screen.findByLabelText('Entité');
  expect(select).toHaveValue('');
  await userEvent.type(screen.getByLabelText('Nom de l\'agent IA'), 'Ventes');
  expect(screen.getByRole('button', { name: /Continuer/ })).toBeDisabled();
});

test('echec de GET /api/entities : champ masque, Continuer possible, erreur journalisee', async () => {
  mockEntities('fail');
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  renderWizard();
  await userEvent.type(screen.getByLabelText('Nom de l\'agent IA'), 'Ventes');
  await waitFor(() => expect(screen.getByRole('button', { name: /Continuer/ })).toBeEnabled());
  expect(screen.queryByLabelText('Entité')).not.toBeInTheDocument();
  expect(err).toHaveBeenCalledWith(expect.stringContaining('[Wizard]'), expect.anything());
});
