import { render, screen } from '@testing-library/react';
import { Button } from '../button';

test('rend un bouton avec le libellé et la classe accent par défaut', () => {
  render(<Button>Valider</Button>);
  const btn = screen.getByRole('button', { name: 'Valider' });
  expect(btn).toBeInTheDocument();
  expect(btn.className).toContain('bg-accent');
});

test('anneau de focus en encre menthe (contraste), pas en menthe', () => {
  render(<Button>Valider</Button>);
  const classes = screen.getByRole('button', { name: 'Valider' }).className.split(/\s+/);
  expect(classes).toContain('focus-visible:ring-accent-ink');
  expect(classes).not.toContain('focus-visible:ring-accent');
});
