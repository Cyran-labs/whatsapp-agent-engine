import { render, screen } from '@testing-library/react';
import { test, expect } from 'vitest';
import { BarChart } from '../bar-chart';

test('hauteurs proportionnelles au max', () => {
  const { container } = render(<BarChart data={[5, 10, 0]} />);
  const bars = container.querySelectorAll('[data-bar]');
  expect(bars).toHaveLength(3);
  expect((bars[0] as HTMLElement).style.height).toBe('50%');
  expect((bars[1] as HTMLElement).style.height).toBe('100%');
  expect((bars[2] as HTMLElement).style.height).toBe('0%');
});

test('aucun gradient', () => {
  const { container } = render(<BarChart data={[1, 2]} highlightIndex={1} />);
  expect(container.innerHTML).not.toMatch(/gradient/i);
  expect(container.querySelectorAll('.bg-accent')).toHaveLength(1);
});

test('max=0 → toutes barres à 0%', () => {
  const { container } = render(<BarChart data={[0, 0]} />);
  container.querySelectorAll('[data-bar]').forEach((b) => expect((b as HTMLElement).style.height).toBe('0%'));
});

test('prop height appliquée au conteneur', () => {
  const { container } = render(<BarChart data={[1, 2]} height={120} />);
  const barContainer = container.querySelector('.flex.items-end');
  expect((barContainer as HTMLElement).style.height).toBe('120px');
});

// recette Q-3
test('série toute à 0 : barres vides, aucune mise en évidence et la mention fournie', () => {
  const { container } = render(<BarChart data={[0, 0, 0]} highlightIndex={0} emptyLabel="Aucun coût sur la période" />);
  expect(screen.getByText('Aucun coût sur la période')).toBeInTheDocument();
  container.querySelectorAll('[data-bar]').forEach((b) => expect((b as HTMLElement).style.height).toBe('0%'));
  expect(container.querySelectorAll('.bg-accent')).toHaveLength(0);
});

// recette Q-3
test('série vide : la mention est affichée, pas de barre', () => {
  const { container } = render(<BarChart data={[]} emptyLabel="Aucun coût sur la période" />);
  expect(screen.getByText('Aucun coût sur la période')).toBeInTheDocument();
  expect(container.querySelectorAll('[data-bar]')).toHaveLength(0);
});

test('au moins une valeur positive : pas de mention, mise en évidence conservée', () => {
  const { container } = render(<BarChart data={[0, 3]} highlightIndex={1} emptyLabel="Aucun coût sur la période" />);
  expect(screen.queryByText('Aucun coût sur la période')).not.toBeInTheDocument();
  expect(container.querySelectorAll('.bg-accent')).toHaveLength(1);
});

// recette 10 nov. 2026 : avec un seul jour de données, une barre pleine largeur sans date ni repère
test('barres de largeur bornée : une seule barre ne remplit pas la largeur', () => {
  const { container } = render(<BarChart data={[3]} labels={['9 nov.']} />);
  const bar = container.querySelector('[data-bar]') as HTMLElement;
  expect(bar.parentElement).toHaveClass('max-w-[56px]');
  expect(bar.parentElement).toHaveClass('flex-1');
});

test('jusqu\'à 7 barres : une date sous chaque barre', () => {
  render(<BarChart data={[1, 2, 3]} labels={['1 nov.', '2 nov.', '3 nov.']} />);
  for (const label of ['1 nov.', '2 nov.', '3 nov.']) expect(screen.getByText(label)).toBeInTheDocument();
});

test('au-delà de 7 barres : seules la première et la dernière date sont écrites', () => {
  const labels = Array.from({ length: 30 }, (_, i) => `${i + 1} nov.`);
  render(<BarChart data={labels.map((_, i) => i + 1)} labels={labels} />);
  expect(screen.getByText('1 nov.')).toBeInTheDocument();
  expect(screen.getByText('30 nov.')).toBeInTheDocument();
  expect(screen.queryByText('15 nov.')).not.toBeInTheDocument();
});

test('série vide ou à 0 : les dates restent sous les barres vides', () => {
  render(<BarChart data={[0]} labels={['9 nov.']} emptyLabel="Aucun coût sur la période" />);
  expect(screen.getByText('9 nov.')).toBeInTheDocument();
});
