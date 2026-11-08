import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect, beforeEach } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import type { Session } from '@/components/providers/session-provider';
import OrganisationLayout from '../../../app/[locale]/(app)/organisation/layout';
import EntitesPage from '../../../app/[locale]/(app)/organisation/entites/page';
import { OrganisationCountsContext } from '../organisation-counts';

vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, className, ...rest }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className} {...rest}>{children}</a>
  ),
  usePathname: () => '/organisation/entites',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  routing: { locales: ['fr', 'en'], defaultLocale: 'fr' },
}));

const org = { client_id: 'ml', name: 'Maison Lumière', role: 'admin' as const, read_only: false };
vi.mock('@/components/providers/session-provider', () => ({
  useSession: (): Session => ({
    me: { id: 1, email: 'claire@maison-lumiere.fr', role: 'user', status: 'active', organizations: [org] },
    activeOrg: org,
    isPlatformAdmin: false,
    isAdmin: true,
    readOnly: false,
    switchOrg: vi.fn(),
    refresh: vi.fn(),
  }),
}));

interface FakeEntity { id: number; name: string; status: 'active' | 'archived'; bots: number; members: number }
interface FakeBot { bot_id: string; name: string; entity_id: number }

let entities: FakeEntity[];
let bots: FakeBot[];
let calls: { method: string; url: string; body: unknown }[];
let nextCreateError: string | null;
let nextArchiveError: string | null;

function reset() {
  entities = [
    { id: 1, name: 'Service client', status: 'active', bots: 2, members: 4 },
    { id: 2, name: 'Boutique Paris Marais', status: 'active', bots: 1, members: 2 },
    { id: 3, name: 'Boutique Lyon', status: 'active', bots: 0, members: 0 },
    { id: 4, name: 'Ancienne boutique', status: 'archived', bots: 0, members: 0 },
  ];
  bots = [
    { bot_id: 'b1', name: 'Support client', entity_id: 1 },
    { bot_id: 'b2', name: 'SAV commandes', entity_id: 1 },
    { bot_id: 'b3', name: 'Conseil beauté Marais', entity_id: 2 },
  ];
  calls = [];
  nextCreateError = null;
  nextArchiveError = null;
}

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    if (url === '/api/entities' && method === 'GET') return jsonRes(entities.filter((e) => e.status === 'active'));
    if (url === '/api/entities?include_archived=true') return jsonRes(entities);
    if (url === '/api/bots/summary') return jsonRes(bots.map((b) => ({ ...b, slug: b.bot_id, status: 'active', languages: ['fr'], default_language: 'fr', numbers: [], messages_total: 0, leads_total: 0, personalized: true })));
    if (url === '/api/entities' && method === 'POST') {
      if (nextCreateError) return jsonRes({ error: { code: 'CONFLICT', message: nextCreateError } }, 409);
      const created: FakeEntity = { id: 10, name: body.name, status: 'active', bots: 0, members: 0 };
      entities.push(created);
      return jsonRes(created, 201);
    }
    const entityMatch = /^\/api\/entities\/(\d+)$/.exec(url);
    if (entityMatch && method === 'PATCH') {
      if (nextArchiveError) return jsonRes({ error: { code: 'CONFLICT', message: nextArchiveError } }, 409);
      const e = entities.find((x) => x.id === Number(entityMatch[1]));
      if (e) Object.assign(e, body);
      return jsonRes(e);
    }
    const botMatch = /^\/api\/bots\/([^/]+)$/.exec(url);
    if (botMatch && method === 'PATCH') {
      const b = bots.find((x) => x.bot_id === botMatch[1]);
      if (b) b.entity_id = body.entity_id;
      return jsonRes(b);
    }
    return jsonRes({}, 404);
  }));
}

const refreshCounts = vi.fn();
function renderPage() {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <OrganisationCountsContext.Provider value={{ refreshCounts }}>
        <EntitesPage />
      </OrganisationCountsContext.Provider>
    </NextIntlClientProvider>,
  );
}

const mutations = (prefix: string) => calls.filter((c) => c.method !== 'GET' && c.url.startsWith(prefix));
const rowOf = (name: string) => screen.getByText(name, { selector: 'span' }).closest('tr') as HTMLElement;

async function openMenu(name: string) {
  const user = userEvent.setup();
  await user.click(within(rowOf(name)).getByRole('button', { name: `Actions pour ${name}` }));
  return user;
}

beforeEach(() => {
  vi.restoreAllMocks();
  refreshCounts.mockReset();
  reset();
  stubFetch();
});

test('en-tête, tableau : nom, pastilles des agents IA, membres, compte des entités actives', async () => {
  renderPage();
  expect(screen.getByRole('heading', { name: 'Entités' })).toBeInTheDocument();
  expect(screen.getByText(/Boutiques, équipes ou services de l'organisation\./)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '+ Nouvelle entité' })).toBeInTheDocument();
  await screen.findByText('Service client', { selector: 'span' });
  expect(screen.getByText('3 entités actives')).toBeInTheDocument();
  const service = within(rowOf('Service client'));
  expect(service.getByText('Support client')).toBeInTheDocument();
  expect(service.getByText('SAV commandes')).toBeInTheDocument();
  expect(service.getByText('4')).toBeInTheDocument();
  expect(within(rowOf('Boutique Paris Marais')).getByText('Conseil beauté Marais')).toBeInTheDocument();
  expect(within(rowOf('Boutique Lyon')).getByText('Aucun agent IA')).toBeInTheDocument();
  expect(screen.queryByText('Ancienne boutique')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Afficher les archivées')).not.toBeChecked();
});

test('menu ⋯ : Renommer, Déplacer un agent IA…, Archiver… ; Archiver absent de la dernière entité active', async () => {
  renderPage();
  await screen.findByText('Service client', { selector: 'span' });
  await openMenu('Service client');
  expect(screen.getByRole('menuitem', { name: 'Renommer' })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Déplacer un agent IA…' })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Archiver…' })).toBeInTheDocument();
});

test('dernière entité active : pas d\'action Archiver', async () => {
  entities = [{ id: 1, name: 'Service client', status: 'active', bots: 0, members: 1 }, { id: 4, name: 'Ancienne boutique', status: 'archived', bots: 0, members: 0 }];
  bots = [];
  renderPage();
  await screen.findByText('Service client', { selector: 'span' });
  await openMenu('Service client');
  expect(screen.getByRole('menuitem', { name: 'Renommer' })).toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: 'Archiver…' })).not.toBeInTheDocument();
});

test('création en ligne : Entrée envoie POST { name }, la liste et le compteur du rail sont relus', async () => {
  renderPage();
  await screen.findByText('Service client', { selector: 'span' });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '+ Nouvelle entité' }));
  expect(screen.getByText('Entrée pour valider, Échap pour annuler')).toBeInTheDocument();
  await user.type(screen.getByRole('textbox', { name: "Nom de l'entité" }), 'Boutique Bordeaux{Enter}');
  await waitFor(() => expect(mutations('/api/entities')).toEqual([{ method: 'POST', url: '/api/entities', body: { name: 'Boutique Bordeaux' } }]));
  await screen.findByText('Boutique Bordeaux', { selector: 'span' });
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.getByText('4 entités actives')).toBeInTheDocument();
  expect(refreshCounts).toHaveBeenCalledTimes(1);
});

test('création : Échap annule sans appel', async () => {
  renderPage();
  await screen.findByText('Service client', { selector: 'span' });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '+ Nouvelle entité' }));
  await user.type(screen.getByRole('textbox', { name: "Nom de l'entité" }), 'Brouillon{Escape}');
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(mutations('/api/entities')).toEqual([]);
  expect(refreshCounts).not.toHaveBeenCalled();
});

test('création : le 409 « nom en double » s\'affiche sous le champ, qui garde sa valeur', async () => {
  nextCreateError = 'Une entité active porte déjà ce nom.';
  renderPage();
  await screen.findByText('Service client', { selector: 'span' });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '+ Nouvelle entité' }));
  const input = screen.getByRole('textbox', { name: "Nom de l'entité" });
  await user.type(input, 'Service client{Enter}');
  expect(await screen.findByRole('alert')).toHaveTextContent('Une entité active porte déjà ce nom.');
  expect(input).toHaveValue('Service client');
  expect(refreshCounts).not.toHaveBeenCalled();
});

test('renommage : le nom devient un champ dans la ligne, Entrée envoie PATCH { name }', async () => {
  renderPage();
  await screen.findByText('Boutique Lyon', { selector: 'span' });
  const user = await openMenu('Boutique Lyon');
  await user.click(screen.getByRole('menuitem', { name: 'Renommer' }));
  const input = screen.getByRole('textbox', { name: "Nom de l'entité" });
  expect(input).toHaveValue('Boutique Lyon');
  await user.clear(input);
  await user.type(input, 'Boutique Lyon Presqu\'île{Enter}');
  await waitFor(() => expect(mutations('/api/entities/3')).toEqual([{ method: 'PATCH', url: '/api/entities/3', body: { name: "Boutique Lyon Presqu'île" } }]));
  await screen.findByText("Boutique Lyon Presqu'île", { selector: 'span' });
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

test('archivage d\'une entité utilisée : agents IA listés (Déplacer →), membres comptés, Archiver désactivé, aucun PATCH', async () => {
  renderPage();
  await screen.findByText('Boutique Paris Marais', { selector: 'span' });
  const user = await openMenu('Boutique Paris Marais');
  await user.click(screen.getByRole('menuitem', { name: 'Archiver…' }));
  const dialog = screen.getByRole('dialog', { name: 'Archiver « Boutique Paris Marais » ?' });
  expect(within(dialog).getByText("Impossible pour l'instant : des agents IA et des membres y sont encore rattachés. Déplacez-les d'abord vers une autre entité.")).toBeInTheDocument();
  expect(within(dialog).getByText('Conseil beauté Marais')).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Déplacer →' })).toBeInTheDocument();
  expect(within(dialog).getByText('Membres actifs')).toBeInTheDocument();
  expect(within(dialog).getByRole('link', { name: 'Voir les 2 membres →' })).toHaveAttribute('href', '/organisation/utilisateurs?entity=2');
  const archive = within(dialog).getByRole('button', { name: 'Archiver' });
  expect(archive).toBeDisabled();
  await user.click(archive);
  expect(mutations('/api/entities')).toEqual([]);
  await user.click(within(dialog).getByRole('button', { name: 'Fermer' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('« Déplacer → » depuis la fenêtre d\'archivage ouvre le déplacement de cet agent IA', async () => {
  renderPage();
  await screen.findByText('Boutique Paris Marais', { selector: 'span' });
  const user = await openMenu('Boutique Paris Marais');
  await user.click(screen.getByRole('menuitem', { name: 'Archiver…' }));
  await user.click(screen.getByRole('button', { name: 'Déplacer →' }));
  const dialog = screen.getByRole('dialog', { name: 'Déplacer un agent IA' });
  expect(within(dialog).getByRole('combobox', { name: 'Agent IA' })).toHaveValue('b3');
});

test('archivage d\'une entité vide : confirmation puis PATCH { status: archived }, compteur relu', async () => {
  renderPage();
  await screen.findByText('Boutique Lyon', { selector: 'span' });
  const user = await openMenu('Boutique Lyon');
  await user.click(screen.getByRole('menuitem', { name: 'Archiver…' }));
  const dialog = screen.getByRole('dialog', { name: 'Archiver « Boutique Lyon » ?' });
  expect(within(dialog).queryByText('Membres actifs')).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: 'Archiver' }));
  await waitFor(() => expect(mutations('/api/entities')).toEqual([{ method: 'PATCH', url: '/api/entities/3', body: { status: 'archived' } }]));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.queryByText('Boutique Lyon', { selector: 'span' })).not.toBeInTheDocument();
  expect(screen.getByText('2 entités actives')).toBeInTheDocument();
  expect(refreshCounts).toHaveBeenCalledTimes(1);
});

test('archivage : un 409 du moteur reste affiché dans la fenêtre, qui reste ouverte', async () => {
  nextArchiveError = "Déplacez d'abord les agents IA et les membres de cette entité.";
  renderPage();
  await screen.findByText('Boutique Lyon', { selector: 'span' });
  const user = await openMenu('Boutique Lyon');
  await user.click(screen.getByRole('menuitem', { name: 'Archiver…' }));
  const dialog = screen.getByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Archiver' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent("Déplacez d'abord les agents IA et les membres de cette entité.");
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

test('« Afficher les archivées » : appelle include_archived=true, ligne Archivée, Réactiver envoie PATCH { status: active }', async () => {
  renderPage();
  await screen.findByText('Service client', { selector: 'span' });
  const user = userEvent.setup();
  await user.click(screen.getByLabelText('Afficher les archivées'));
  await waitFor(() => expect(calls.some((c) => c.url === '/api/entities?include_archived=true')).toBe(true));
  await screen.findByText('Ancienne boutique', { selector: 'span' });
  expect(screen.getByLabelText('Afficher les archivées (1)')).toBeChecked();
  const row = within(rowOf('Ancienne boutique'));
  expect(row.getByText('Archivée')).toBeInTheDocument();
  expect(row.queryByRole('button', { name: /Actions pour/ })).not.toBeInTheDocument();
  expect(screen.getByText('3 entités actives')).toBeInTheDocument();
  await user.click(row.getByRole('button', { name: 'Réactiver' }));
  await waitFor(() => expect(mutations('/api/entities')).toEqual([{ method: 'PATCH', url: '/api/entities/4', body: { status: 'active' } }]));
  await waitFor(() => expect(screen.getByText('4 entités actives')).toBeInTheDocument());
  expect(refreshCounts).toHaveBeenCalledTimes(1);
});

test('décocher « Afficher les archivées » masque les lignes archivées et garde le compte', async () => {
  renderPage();
  await screen.findByText('Service client', { selector: 'span' });
  const user = userEvent.setup();
  await user.click(screen.getByLabelText('Afficher les archivées'));
  await screen.findByText('Ancienne boutique', { selector: 'span' });
  await user.click(screen.getByLabelText('Afficher les archivées (1)'));
  expect(screen.queryByText('Ancienne boutique', { selector: 'span' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Afficher les archivées (1)')).not.toBeChecked();
});

test('déplacement : la liste cible exclut la source et les archivées, Déplacer envoie PATCH /api/bots/<id> { entity_id }', async () => {
  renderPage();
  await screen.findByText('Service client', { selector: 'span' });
  const user = userEvent.setup();
  await user.click(screen.getByLabelText('Afficher les archivées'));
  await screen.findByText('Ancienne boutique', { selector: 'span' });
  await user.click(within(rowOf('Boutique Paris Marais')).getByRole('button', { name: 'Actions pour Boutique Paris Marais' }));
  await user.click(screen.getByRole('menuitem', { name: 'Déplacer un agent IA…' }));
  const dialog = screen.getByRole('dialog', { name: 'Déplacer un agent IA' });
  expect(within(dialog).getByText("Depuis « Boutique Paris Marais ». Le numéro WhatsApp, les connexions et l'historique ne changent pas.")).toBeInTheDocument();
  const target = within(dialog).getByRole('combobox', { name: "Vers l'entité" });
  expect(within(target).getAllByRole('option').map((o) => o.textContent)).toEqual(['Service client', 'Boutique Lyon']);
  await user.selectOptions(target, 'Boutique Lyon');
  await user.click(within(dialog).getByRole('button', { name: 'Déplacer' }));
  await waitFor(() => expect(mutations('/api/bots')).toEqual([{ method: 'PATCH', url: '/api/bots/b3', body: { entity_id: 3 } }]));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(within(rowOf('Boutique Lyon')).getByText('Conseil beauté Marais')).toBeInTheDocument();
});

test('Échap ferme une fenêtre', async () => {
  renderPage();
  await screen.findByText('Boutique Lyon', { selector: 'span' });
  const user = await openMenu('Boutique Lyon');
  await user.click(screen.getByRole('menuitem', { name: 'Archiver…' }));
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('dans le layout Organisation, la création met à jour le compteur Entités du rail', async () => {
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <OrganisationLayout><EntitesPage /></OrganisationLayout>
    </NextIntlClientProvider>,
  );
  const link = screen.getByRole('link', { name: /Entités/ });
  await waitFor(() => expect(within(link).getByText('3')).toBeInTheDocument());
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '+ Nouvelle entité' }));
  await user.type(screen.getByRole('textbox', { name: "Nom de l'entité" }), 'Boutique Bordeaux{Enter}');
  await waitFor(() => expect(within(screen.getByRole('link', { name: /Entités/ })).getByText('4')).toBeInTheDocument());
});

test('renommage sans changement : le champ se ferme sans appel', async () => {
  renderPage();
  await screen.findByText('Boutique Lyon', { selector: 'span' });
  const user = await openMenu('Boutique Lyon');
  await user.click(screen.getByRole('menuitem', { name: 'Renommer' }));
  await user.type(screen.getByRole('textbox', { name: "Nom de l'entité" }), '{Enter}');
  await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
  expect(mutations('/api/entities')).toEqual([]);
});

test('création avec un nom vide ou d\'espaces : message local, aucun POST', async () => {
  renderPage();
  await screen.findByText('Service client', { selector: 'span' });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '+ Nouvelle entité' }));
  const input = screen.getByRole('textbox', { name: "Nom de l'entité" });
  await user.type(input, '{Enter}');
  expect(await screen.findByRole('alert')).toHaveTextContent('Le nom est requis.');
  await user.type(input, '   {Enter}');
  expect(screen.getByRole('alert')).toHaveTextContent('Le nom est requis.');
  expect(mutations('/api/entities')).toEqual([]);
});

test('renommage avec un nom effacé : message local, aucun PATCH', async () => {
  renderPage();
  await screen.findByText('Boutique Lyon', { selector: 'span' });
  const user = await openMenu('Boutique Lyon');
  await user.click(screen.getByRole('menuitem', { name: 'Renommer' }));
  await user.clear(screen.getByRole('textbox', { name: "Nom de l'entité" }));
  await user.keyboard('{Enter}');
  expect(await screen.findByRole('alert')).toHaveTextContent('Le nom est requis.');
  expect(mutations('/api/entities')).toEqual([]);
});

test('rouvrir « Renommer » après Échap repart du nom actuel, sans brouillon ni erreur', async () => {
  renderPage();
  await screen.findByText('Boutique Lyon', { selector: 'span' });
  let user = await openMenu('Boutique Lyon');
  await user.click(screen.getByRole('menuitem', { name: 'Renommer' }));
  const input = screen.getByRole('textbox', { name: "Nom de l'entité" });
  await user.clear(input);
  await user.keyboard('{Enter}');
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  await user.type(input, 'Brouillon{Escape}');
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  user = await openMenu('Boutique Lyon');
  await user.click(screen.getByRole('menuitem', { name: 'Renommer' }));
  expect(screen.getByRole('textbox', { name: "Nom de l'entité" })).toHaveValue('Boutique Lyon');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(mutations('/api/entities')).toEqual([]);
});

test('archivage : un double clic sur Archiver n\'envoie qu\'un PATCH', async () => {
  renderPage();
  await screen.findByText('Boutique Lyon', { selector: 'span' });
  const user = await openMenu('Boutique Lyon');
  await user.click(screen.getByRole('menuitem', { name: 'Archiver…' }));
  await user.dblClick(within(screen.getByRole('dialog')).getByRole('button', { name: 'Archiver' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(mutations('/api/entities')).toHaveLength(1);
});

test('déplacement : un double clic sur Déplacer n\'envoie qu\'un PATCH', async () => {
  renderPage();
  await screen.findByText('Boutique Paris Marais', { selector: 'span' });
  const user = await openMenu('Boutique Paris Marais');
  await user.click(screen.getByRole('menuitem', { name: 'Déplacer un agent IA…' }));
  await user.dblClick(within(screen.getByRole('dialog')).getByRole('button', { name: 'Déplacer' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(mutations('/api/bots')).toHaveLength(1);
});
