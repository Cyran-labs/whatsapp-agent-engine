import { render, screen, waitFor, within } from '@testing-library/react';
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

// audit R-18
test('entités illisibles : LoadError, la suite est bloquée avec sa raison, Réessayer recharge', async () => {
  let failing = true;
  const fn = vi.fn(async (url: string) => {
    if (url !== '/api/entities') return new Response('{}', { status: 404 });
    return failing ? new Response('{}', { status: 500 }) : new Response(JSON.stringify(THREE), { status: 200 });
  });
  vi.stubGlobal('fetch', fn);
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  renderWizard();
  await userEvent.type(screen.getByLabelText('Nom de l\'agent IA'), 'Ventes');
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('La liste des entités n\'a pas pu être chargée.');
  expect(screen.queryByLabelText('Entité')).not.toBeInTheDocument();
  const next = screen.getByRole('button', { name: /Continuer/ });
  expect(next).toBeDisabled();
  const reason = screen.getByText('Chargez la liste des entités pour continuer.');
  expect(next).toHaveAttribute('aria-describedby', reason.id);
  expect(err).toHaveBeenCalledWith(expect.stringContaining('[Wizard]'), expect.anything());
  failing = false;
  await userEvent.click(within(alert).getByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByLabelText('Entité')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByText('Chargez la liste des entités pour continuer.')).not.toBeInTheDocument();
});

test('chargement des entités : champ Entité en squelette, puis le vrai champ', async () => {
  let release: (res: Response) => void = () => undefined;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
  const { container } = renderWizard();
  const slot = container.querySelector('[data-entity-skeleton]');
  expect(slot).not.toBeNull();
  expect(slot?.querySelectorAll('[data-skeleton]')).toHaveLength(2);
  expect(screen.queryByText(/Chargement/)).not.toBeInTheDocument();
  release(new Response(JSON.stringify(THREE), { status: 200 }));
  expect(await screen.findByLabelText('Entité')).toBeInTheDocument();
  expect(container.querySelector('[data-entity-skeleton]')).toBeNull();
});


/** Du nom saisi au clic sur « Créer & tester », avec une entité choisie si le champ existe. */
async function createFromStep1(entityName?: string) {
  await userEvent.type(await screen.findByLabelText('Nom de l\'agent IA'), 'Ventes');
  if (entityName) await userEvent.selectOptions(await screen.findByLabelText('Entité'), entityName);
  await waitFor(() => expect(screen.getByRole('button', { name: /Continuer/ })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: /Continuer/ }));
  await userEvent.type(screen.getByLabelText('Rôle / métier'), 'Conseiller');
  await userEvent.click(screen.getByRole('button', { name: /Créer & tester/ }));
}

function stubCreation(lists: unknown[][], refusal: { code: string; message: string; path: string; reason: string }) {
  let reads = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/entities') return new Response(JSON.stringify(lists[Math.min(reads++, lists.length - 1)]), { status: 200 });
    if (url === '/api/bots' && init?.method === 'POST') {
      return new Response(JSON.stringify({ error: { code: refusal.code, message: 'Données invalides.', reason: refusal.reason, details: [{ path: refusal.path, message: refusal.message }] } }), { status: 400 });
    }
    return new Response('{}', { status: 404 });
  }));
}

// audit R-2
test('l\'entité refusée à la création : retour à l\'étape 1, champ Entité affiché et en erreur, liste relue', async () => {
  stubCreation([THREE, [entity(1, 'Siège'), entity(7, 'Lyon')]], { code: 'VALIDATION_ERROR', message: 'Entité introuvable ou archivée.', path: 'entity_id', reason: 'bot.entity_unavailable' });
  renderWizard();
  await createFromStep1('Bordeaux');
  expect(await screen.findByRole('heading', { name: 'Donnez vie à votre agent IA' })).toBeInTheDocument();
  const select = await screen.findByLabelText('Entité');
  const message = screen.getByText('Entité introuvable ou archivée.');
  expect(message).toHaveClass('text-danger');
  expect(select).toHaveAttribute('aria-invalid', 'true');
  expect(select).toHaveAttribute('aria-describedby', message.id);
  // Bordeaux n'est plus proposée : le choix est vide et la suite bloquée jusqu'à un nouveau choix.
  expect(select).toHaveValue('');
  expect(screen.queryByRole('option', { name: 'Bordeaux' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Continuer/ })).toBeDisabled();
  expect(screen.queryByText(/Vérifiez les champs/)).not.toBeInTheDocument();
  await userEvent.selectOptions(select, 'Lyon');
  expect(screen.queryByText('Entité introuvable ou archivée.')).not.toBeInTheDocument();
  expect(select).not.toHaveAttribute('aria-invalid');
  expect(screen.getByRole('button', { name: /Continuer/ })).toBeEnabled();
});

// audit R-2
test('« Choisissez une entité » alors que le champ n\'était pas affiché : retour à l\'étape 1, le champ apparaît en erreur', async () => {
  stubCreation([ONE, THREE], { code: 'VALIDATION_ERROR', message: 'Choisissez une entité.', path: 'entity_id', reason: 'bot.entity_required' });
  renderWizard();
  await createFromStep1();
  expect(await screen.findByRole('heading', { name: 'Donnez vie à votre agent IA' })).toBeInTheDocument();
  const select = await screen.findByLabelText('Entité');
  expect(select).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByText('Choisissez une entité.')).toHaveClass('text-danger');
});

// audit R-2
test('« Choisissez une entité » sans champ à afficher (une entité active seulement) : message en alerte à l\'étape 1', async () => {
  stubCreation([ONE, ONE], { code: 'VALIDATION_ERROR', message: 'Choisissez une entité.', path: 'entity_id', reason: 'bot.entity_required' });
  renderWizard();
  await createFromStep1();
  expect(await screen.findByRole('heading', { name: 'Donnez vie à votre agent IA' })).toBeInTheDocument();
  expect(await screen.findByRole('alert')).toHaveTextContent('Choisissez une entité.');
  expect(screen.queryByLabelText('Entité')).not.toBeInTheDocument();
});
