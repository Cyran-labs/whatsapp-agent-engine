import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { renderIntl } from '@/components/connections/__tests__/helpers';
import ErrorState from '../error';

// contre-audit D-5 : la page d'erreur de dernier recours est annoncée comme une alerte et garde « Réessayer ».
test('contre-audit D-5 : page d\'erreur de dernier recours : alerte, titre et Réessayer qui relance', async () => {
  const reset = vi.fn();
  renderIntl(<ErrorState error={new Error('x')} reset={reset} />);
  expect(screen.getByRole('alert')).toHaveTextContent("Quelque chose s'est mal passé");
  await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(reset).toHaveBeenCalledTimes(1);
});
