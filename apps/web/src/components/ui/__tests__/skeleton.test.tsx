import { render } from '@testing-library/react';
import { test, expect } from 'vitest';
import { Skeleton, SkeletonRows } from '../skeleton';

test('Skeleton : bloc surface douce, bordure, rayon md, pulsation d\'opacité seulement sans mouvement réduit', () => {
  const { container } = render(<Skeleton className="h-4 w-20" />);
  const block = container.querySelector('[data-skeleton]');
  expect(block).not.toBeNull();
  expect(block).toHaveAttribute('aria-hidden', 'true');
  for (const c of ['bg-surface-subtle', 'border', 'border-border', 'rounded-md', 'motion-safe:animate-pulse', 'h-4', 'w-20']) {
    expect(block?.className.split(' ')).toContain(c);
  }
  // pas de pulsation inconditionnelle, pas de shimmer en dégradé
  expect(block?.className.split(' ')).not.toContain('animate-pulse');
  expect(block?.className).not.toMatch(/gradient/);
});

test('SkeletonRows : 3 lignes par défaut, une cellule par colonne, aucune lecture d\'écran', () => {
  const { container } = render(
    <table><tbody><SkeletonRows cells={['title', 'line', 'pill', 'none']} cellClassName="px-4" /></tbody></table>,
  );
  const rows = container.querySelectorAll('tr[data-skeleton-row]');
  expect(rows).toHaveLength(3);
  rows.forEach((row) => {
    expect(row.querySelectorAll('td')).toHaveLength(4);
    expect(row).toHaveAttribute('aria-hidden', 'true');
  });
  expect(rows[0].querySelectorAll('td')[3].querySelector('[data-skeleton]')).toBeNull();
  expect(container.textContent).toBe('');
});
