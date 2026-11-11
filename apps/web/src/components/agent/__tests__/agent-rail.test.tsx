import { render, screen } from '@testing-library/react';
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
      <AgentRail botId="b1" activeKey={active} agent={{ name: 'Support', status: 'active', status_reason: null, not_responding: null, account_state: 'connected' }} />
    </NextIntlClientProvider>,
  );

test('6 sections affichées', () => {
  wrap('overview');
  ["Vue d'ensemble", 'Conversations & Leads', 'Personnalité & contenu', 'CRM', 'Usage & coûts', 'Paramètres'].forEach((l) =>
    expect(screen.getByText(l)).toBeInTheDocument(),
  );
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
  renderAgent({ name: 'Support', status: 'active', status_reason: null, not_responding: 'account_not_connected', account_state: 'error' });
  const header = screen.getByText('Support').closest('aside > div') as HTMLElement;
  expect(header).toContainElement(screen.getByText('Online'));
  const mention = screen.getByText('Ne répond pas');
  expect(header).toContainElement(mention);
  mention.focus();
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Ne répond pas : compte WhatsApp en erreur');
});

test('agent IA Offline : motif à côté de la pastille, sous le nom', () => {
  renderAgent({ name: 'Support', status: 'paused', status_reason: null, not_responding: null, account_state: 'connected' });
  expect(screen.getByText('Offline')).toBeInTheDocument();
  expect(screen.getByText('Arrêté par un administrateur')).toBeInTheDocument();
});

// audit R-23 : lecture en échec, « Statut inconnu » sans mention
test('statut inconnu : ni mention ni motif', () => {
  renderAgent({ name: 'b1', status: 'unknown', status_reason: null, not_responding: null, account_state: null });
  expect(screen.getByText('Statut inconnu')).toBeInTheDocument();
  expect(screen.queryByText('Ne répond pas')).not.toBeInTheDocument();
});

test("repère actif : aria-current et fond de l'entrée active de la colonne, absents sur les autres entrées", () => {
  wrap('overview');
  const active = screen.getByText("Vue d'ensemble").closest('a');
  expect(active).toHaveAttribute('aria-current', 'page');
  expect(active?.className).toContain('bg-surface-subtle');
  const other = screen.getByText('Usage & coûts').closest('a');
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

// recette Q-4
test('admin : bloc Organisation avec le lien « Numéros WhatsApp de l\'organisation » vers les Connexions', () => {
  wrap('overview');
  expect(screen.getByText('Organisation')).toBeInTheDocument();
  const link = screen.getByRole('link', { name: "Numéros WhatsApp de l'organisation" });
  expect(link.getAttribute('href')).toMatch(/\/organisation\/connexions$/);
  expect(link).not.toHaveAttribute('aria-current');
});

// recette Q-4
test('conseiller : ni bloc Organisation ni lien vers les numéros', () => {
  session.isAdmin = false;
  wrap('overview');
  expect(screen.queryByText('Organisation')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: "Numéros WhatsApp de l'organisation" })).not.toBeInTheDocument();
});
