import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from 'vitest';

const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8');

test('globals.css porte les tokens canoniques (clair)', () => {
  expect(css).toMatch(/--border:\s*#DCE5DF/);          // corrige #E2E8E4
  expect(css).toMatch(/--border-strong:\s*#C5D2C8/);
  expect(css).toMatch(/--surface-subtle:\s*#F4F8EE/);
  expect(css).toMatch(/--tertiary:\s*#BE5A4E/);
  expect(css).toMatch(/--success-soft:\s*#D1FAE5/);
  expect(css).toMatch(/--danger-soft:\s*#FEE2E2/);
  expect(css).toMatch(/--warning-soft:\s*#FEF3C7/);
  expect(css).toMatch(/--sh-sm:\s*0 1px 3px rgba\(20,50,42,\.05\)/);
  expect(css).toMatch(/--sh-lg:\s*0 8px 28px rgba\(20,50,42,\.14\)/);
  expect(css).toMatch(/--r-sm:\s*4px/);
  expect(css).toMatch(/--r-pill:\s*999px/);
});

test('globals.css ne contient aucun gradient', () => {
  expect(css).not.toMatch(/gradient/i);
});

test('globals.css porte les tokens sombres recalés', () => {
  expect(css).toMatch(/--surface:\s*#122620/);
  expect(css).toMatch(/--border:\s*#1E463B/);
});
