import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import { Money } from '../money';

const wrap = (node: React.ReactNode) => render(<NextIntlClientProvider locale="fr" messages={messages}>{node}</NextIntlClientProvider>);

// tâche 15 : un montant inconnu ne se lit ni « NaN » ni « 0,00 $ », et n'a pas d'équivalent en euros
test.each([Number.NaN, Number.POSITIVE_INFINITY, -1])('montant %s : « indisponible » seul, sans équivalent en euros', (usd) => {
  const { container } = wrap(<Money usd={usd} rate={{ rate: 0.92, date: '2026-11-01' }} />);
  expect(container).toHaveTextContent(/^indisponible$/);
  expect(container.textContent).not.toMatch(/NaN|0,00|€/);
});

test('montant valide : dollars puis équivalent en euros', () => {
  wrap(<Money usd={1.234} rate={{ rate: 0.92, date: '2026-11-01' }} />);
  expect(screen.getByText(/1,23/)).toBeInTheDocument();
  expect(screen.getByText(/1,14/)).toBeInTheDocument();
});
