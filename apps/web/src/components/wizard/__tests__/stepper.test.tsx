import { render, screen } from '@testing-library/react';
import { test, expect } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import { Stepper } from '../stepper';

function renderStepper(current: 1 | 2 | 3 | 4 | 5) {
  render(<NextIntlClientProvider locale="fr" messages={messages}><Stepper current={current} /></NextIntlClientProvider>);
}

test('cinq étapes : Identité, Personnalité, Tester, Numéro, Activer', () => {
  renderStepper(1);
  const labels = ['Identité', 'Personnalité', 'Tester', 'Numéro', 'Activer'];
  for (const label of labels) expect(screen.getByText(label)).toBeInTheDocument();
  expect(screen.getAllByRole('listitem')).toHaveLength(5);
});

test('l\'étape courante est marquée, les précédentes cochées', () => {
  renderStepper(4);
  const items = screen.getAllByRole('listitem');
  expect(items[3]).toHaveAttribute('aria-current', 'step');
  expect(items[3]).toHaveTextContent('Numéro');
  items.forEach((item, i) => { if (i !== 3) expect(item).not.toHaveAttribute('aria-current'); });
  expect(items[0]).toHaveTextContent('✓');
  expect(items[2]).toHaveTextContent('✓');
  expect(items[4]).toHaveTextContent('5');
});
