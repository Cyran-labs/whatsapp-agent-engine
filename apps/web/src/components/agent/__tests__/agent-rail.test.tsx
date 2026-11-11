import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect, vi, beforeEach } from 'vitest';
import messages from '../../../../messages/fr.json';
import { AgentRail } from '../agent-rail';
import type { AgentInfo } from '../agent-context';

const session = vi.hoisted(() => ({ isAdmin: true }));
vi.mock('@/components/providers/session-provider', () => ({ useSession: () => session }));

beforeEach(() => { session.isAdmin = true; });

const wrap = (active: string) =>
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <AgentRail botId="b1" activeKey={active} agent={{ name: 'Support', status: 'active', status_reason: null, not_responding: null, account_state: 'connected', entity_id: 1, entity_name: 'Siège Paris', entities: 'ready' }} />
    </NextIntlClientProvider>,
  );

// spec 6.4 et 10.3 : « et » au lieu de « & », « Réglages » au lieu de « Paramètres »
test('6 sections affichées, aux libellés de la spec', () => {
  wrap('overview');
  ["Vue d'ensemble", 'Conversations et leads', 'Personnalité et contenu', 'CRM', 'Usage et coûts', 'Réglages'].forEach((l) =>
    expect(screen.getByText(l)).toBeInTheDocument(),
  );
  expect(screen.queryByText(/&/)).not.toBeInTheDocument();
  expect(screen.queryByText('Paramètres')).not.toBeInTheDocument();
});

test('« Réglages » à venir : non lien « Soon », sa bulle dit les réglages de l\'agent IA', async () => {
  wrap('overview');
  const settings = screen.getByText('Réglages').closest('[aria-disabled="true"]') as HTMLElement;
  expect(settings).not.toHaveAttribute('href');
  expect(settings).toHaveTextContent('Soon');
  settings.focus();
  expect(await screen.findByRole('tooltip')).toHaveTextContent("Disponible prochainement : les réglages de l'agent IA.");
});

// prototype 7 : la ligne Entité sous la pastille ; absente quand l'entité n'est pas lue
test('ligne « Entité · {nom} » sous la pastille, absente sans entité lue', () => {
  wrap('overview');
  const line = screen.getByText('Entité · Siège Paris');
  const header = screen.getByText('Support').closest('aside > div > div') as HTMLElement;
  expect(header).toContainElement(line);
  expect(screen.getByText('Online').compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  cleanup();
  renderAgent({ name: 'Support', status: 'active', status_reason: null, not_responding: null, account_state: 'connected', entity_id: null, entity_name: null, entities: 'ready' });
  expect(screen.queryByText(/^Entité ·/)).not.toBeInTheDocument();
});

// spec 5.2 : une section à venir est grisée, porte « Soon », n'est pas un lien et dit au focus ce qu'elle apportera
test('sections disponibles = liens, sections à venir = non-liens « Soon » avec leur bulle', async () => {
  wrap('overview');
  const links = screen.getAllByRole('link');
  expect(links.some((a) => a.getAttribute('href')?.endsWith('/agents/b1'))).toBe(true);
  expect(links.some((a) => a.getAttribute('href')?.endsWith('/agents/b1/usage'))).toBe(true);
  expect(screen.getAllByText('Soon')).toHaveLength(4);
  expect(screen.queryByText('à venir')).not.toBeInTheDocument();
  const crm = screen.getByText('CRM').closest('[aria-disabled="true"]') as HTMLElement;
  expect(crm).not.toHaveAttribute('href');
  crm.focus();
  expect(await screen.findByRole('tooltip')).toHaveTextContent("Disponible prochainement : l'envoi des leads vers votre CRM.");
});

test("nom + statut de l agent dans l entête du rail", () => {
  wrap('overview');
  expect(screen.getByText('Support')).toBeInTheDocument();
  expect(screen.getByText('Online')).toBeInTheDocument();
  expect(screen.queryByText('Ne répond pas')).not.toBeInTheDocument();
});

const renderAgent = (agent: AgentInfo) =>
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <AgentRail botId="b1" activeKey="overview" agent={agent} />
    </NextIntlClientProvider>,
  );

// spec 7.3, point 4 : la mention sous le nom de l'agent IA, avec sa pastille
test('agent IA Online qui ne répond pas : mention « Ne répond pas » sous le nom, motif en bulle', async () => {
  renderAgent({ name: 'Support', status: 'active', status_reason: null, not_responding: 'account_not_connected', account_state: 'error', entity_id: null, entity_name: null, entities: 'ready' });
  const header = screen.getByText('Support').closest('aside > div') as HTMLElement;
  expect(header).toContainElement(screen.getByText('Online'));
  const mention = screen.getByText('Ne répond pas');
  expect(header).toContainElement(mention);
  mention.focus();
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Ne répond pas : compte WhatsApp en erreur');
});

test('agent IA Offline : motif à côté de la pastille, sous le nom', () => {
  renderAgent({ name: 'Support', status: 'paused', status_reason: null, not_responding: null, account_state: 'connected', entity_id: null, entity_name: null, entities: 'ready' });
  const header = screen.getByText('Support').closest('aside > div') as HTMLElement;
  const pill = screen.getByText('Offline');
  const reason = screen.getByText('Arrêté par un administrateur');
  expect(header).toContainElement(pill);
  expect(header).toContainElement(reason);
  expect(pill.parentElement).toContainElement(reason);
});

// audit R-23 : lecture en échec, « Statut inconnu » sans mention
// point d'attention 4 : même si une mention et un motif arrivaient avec un statut qui ne sert pas, aucun n'est affiché
test('statut inconnu : ni mention ni motif', () => {
  renderAgent({ name: 'b1', status: 'unknown', status_reason: 'number_removed', not_responding: 'account_not_connected', account_state: 'error', entity_id: null, entity_name: null, entities: 'ready' });
  expect(screen.getByText('Statut inconnu')).toBeInTheDocument();
  expect(screen.queryByText('Ne répond pas')).not.toBeInTheDocument();
  expect(screen.queryByText('Numéro retiré')).not.toBeInTheDocument();
});

test("repère actif : aria-current et fond de l'entrée active de la colonne, absents sur les autres entrées", () => {
  wrap('overview');
  const active = screen.getByText("Vue d'ensemble").closest('a');
  expect(active).toHaveAttribute('aria-current', 'page');
  expect(active?.className).toContain('bg-surface-subtle');
  const other = screen.getByText('Usage et coûts').closest('a');
  expect(other).not.toHaveAttribute('aria-current');
  expect(other?.className).not.toContain('font-semibold');
});

test('agent IA en cours de chargement : nom et statut en squelette, jamais un statut par défaut', () => {
  const { container } = render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <AgentRail botId="b1" activeKey="overview" agent={null} />
    </NextIntlClientProvider>,
  );
  expect(screen.queryByText('Draft')).not.toBeInTheDocument();
  expect(container.querySelector('aside > div')?.querySelectorAll('[data-skeleton]')).toHaveLength(2);
});

// recette Q-4
test('plus de « Connexions » à venir : l\'entrée à venir s\'appelle CRM', () => {
  wrap('overview');
  expect(screen.queryByText('Connexions')).not.toBeInTheDocument();
  const crm = screen.getByText('CRM');
  expect(crm.closest('a')).toBeNull();
  expect(crm.closest('[aria-disabled="true"]')).toHaveTextContent('Soon');
});

// recette Q-4 ; spec en-tête 2.3 : le chemin vers les numéros WhatsApp de l'organisation est un encart bordé en bas de la
// colonne, qui se voit, avec son lien « Ouvrir Connexions ↗ » (le lien change d'espace et le dit, A-7)
test('admin : encart « Numéros WhatsApp de l\'organisation » en bas de colonne, lien « Ouvrir Connexions ↗ » vers les Connexions', () => {
  wrap('overview');
  const column = screen.getByRole('complementary');
  const link = within(column).getByRole('link', { name: 'Ouvrir Connexions ↗' });
  expect(link.getAttribute('href')).toMatch(/\/organisation\/connexions$/);
  expect(link).not.toHaveAttribute('aria-current');
  const box = link.closest('[data-column-connections]') as HTMLElement;
  expect(box).not.toBeNull();
  expect(box).toHaveTextContent("Numéros WhatsApp de l'organisation");
  expect(box.className).toMatch(/\bborder\b/);
  // en bas de colonne : dans le pied, après les sections de l'agent IA, et plus dans un groupe « Organisation »
  expect(column.lastElementChild).toContainElement(box);
  expect(screen.queryByText('Organisation')).not.toBeInTheDocument();
});

// recette Q-4
test('conseiller : ni encart ni lien vers les numéros', () => {
  session.isAdmin = false;
  wrap('overview');
  expect(document.querySelector('[data-column-connections]')).toBeNull();
  expect(screen.queryByRole('link', { name: /Numéros WhatsApp de l'organisation/ })).not.toBeInTheDocument();
  expect(screen.queryByText(/Connexions/)).not.toBeInTheDocument();
});
