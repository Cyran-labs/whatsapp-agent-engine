import { render, screen } from '@testing-library/react';
import { test, expect } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import { Stepper, StepCounter, STEP_COUNT } from '../stepper';

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

test('les étapes faites se lisent « terminée » et leur coche est masquée aux lecteurs d\'écran', () => {
  renderStepper(3);
  const items = screen.getAllByRole('listitem');
  expect(items[0]).toHaveTextContent('Identité (terminée)');
  expect(items[1]).toHaveTextContent('Personnalité (terminée)');
  expect(items[2]).not.toHaveTextContent('terminée');
  expect(items[3]).not.toHaveTextContent('terminée');
  const check = screen.getAllByText('✓')[0]!;
  expect(check).toHaveAttribute('aria-hidden', 'true');
});

test('étapes sur une ligne : seul le libellé de l\'étape courante reste affiché sous 768 px, les autres restent lisibles aux lecteurs d\'écran', () => {
  renderStepper(2);
  expect(screen.getByText('Personnalité')).not.toHaveClass('sr-only');
  expect(screen.getByText('Identité')).toHaveClass('sr-only', 'md:not-sr-only');
  expect(screen.getByText('Activer')).toHaveClass('sr-only', 'md:not-sr-only');
});

test('le compteur d\'étape dérive son total du stepper', () => {
  expect(STEP_COUNT).toBe(5);
  render(<StepCounter step={4} />);
  expect(screen.getByText(`4 / ${STEP_COUNT}`)).toBeInTheDocument();
});
