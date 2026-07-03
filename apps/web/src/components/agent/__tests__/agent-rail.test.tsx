import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import { AgentRail } from '../agent-rail';

const wrap = (active: string) =>
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <AgentRail botId="b1" activeKey={active} agentName="Support" status="active" />
    </NextIntlClientProvider>,
  );

test('6 sections affichées', () => {
  wrap('overview');
  ["Vue d'ensemble", 'Conversations & Leads', 'Personnalité & contenu', 'Connexions', 'Usage & coûts', 'Paramètres'].forEach((l) =>
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
  expect(screen.getByText('Actif')).toBeInTheDocument();
});
