import { render } from '@testing-library/react';
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
