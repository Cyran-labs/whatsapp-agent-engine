import { render, screen } from '@testing-library/react';
import { Button } from '../button';

test('rend un bouton avec le libellé et la classe accent par défaut', () => {
  render(<Button>Valider</Button>);
  const btn = screen.getByRole('button', { name: 'Valider' });
  expect(btn).toBeInTheDocument();
  expect(btn.className).toContain('bg-accent');
});
