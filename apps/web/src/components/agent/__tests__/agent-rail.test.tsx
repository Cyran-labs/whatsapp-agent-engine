import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect, vi, beforeEach } from 'vitest';
import messages from '../../../../messages/fr.json';
import { AgentRail } from '../agent-rail';

const session = vi.hoisted(() => ({ isAdmin: true }));
vi.mock('@/components/providers/session-provider', () => ({ useSession: () => session }));

beforeEach(() => { session.isAdmin = true; });

const wrap = (active: string) =>
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <AgentRail botId="b1" activeKey={active} agentName="Support" status="active" />
    </NextIntlClientProvider>,
  );

test('6 sections affichées', () => {
  wrap('overview');
  ["Vue d'ensemble", 'Conversations & Leads', 'Personnalité & contenu', 'CRM', 'Usage & coûts', 'Paramètres'].forEach((l) =>
    expect(screen.getByText(l)).toBeInTheDocument(),
  );
});

test('sections actives = liens, "à venir" = non-liens', () => {
  wrap('overview');
  const links = screen.getAllByRole('link');
  expect(links.some((a) => a.getAttribute('href')?.endsWith('/agents/b1'))).toBe(true);
  expect(links.some((a) => a.getAttribute('href')?.endsWith('/agents/b1/usage'))).toBe(true);
  expect(screen.getAllByText('à venir')).toHaveLength(4);
});

test("nom + statut de l agent dans l entête du rail", () => {
  wrap('overview');
  expect(screen.getByText('Support')).toBeInTheDocument();
  expect(screen.getByText('Ouvert à tous')).toBeInTheDocument();
});

test("repère actif : liseré 3 px en encre menthe et fond doux, absent sur les autres entrées", () => {
  wrap('overview');
  const active = screen.getByText("Vue d'ensemble").closest('a');
  expect(active?.className).toContain('shadow-[inset_3px_0_0_var(--accent-ink)]');
  expect(active?.className).toContain('bg-accent-soft');
  const other = screen.getByText('Usage & coûts').closest('a');
  expect(other?.className).not.toContain('--accent-ink');
});

test('agent IA en cours de chargement : nom et statut en squelette, jamais un statut par défaut', () => {
  const { container } = render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <AgentRail botId="b1" activeKey="overview" agentName={null} status={null} />
    </NextIntlClientProvider>,
  );
  expect(screen.queryByText('Brouillon')).not.toBeInTheDocument();
  expect(container.querySelector('aside > div')?.querySelectorAll('[data-skeleton]')).toHaveLength(2);
});

// recette Q-4
test('plus de « Connexions · à venir » : l\'entrée à venir s\'appelle CRM', () => {
  wrap('overview');
  expect(screen.queryByText('Connexions')).not.toBeInTheDocument();
  const crm = screen.getByText('CRM');
  expect(crm.closest('a')).toBeNull();
  expect(crm.parentElement).toHaveTextContent('à venir');
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
