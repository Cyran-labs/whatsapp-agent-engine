import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from 'vitest';

const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8');

test('globals.css porte les tokens canoniques (clair)', () => {
  expect(css).toMatch(/--border:\s*#DCE5DF/);          // corrige #E2E8E4
  expect(css).toMatch(/--border-strong:\s*#C5D2C8/);
  expect(css).toMatch(/--surface-subtle:\s*#F4F8EE/);
  expect(css).toMatch(/--tertiary:\s*#BE5A4E/);
  expect(css).toMatch(/--success-soft:\s*#DCFCE7/);
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

test('globals.css porte la charte Émeraude·Menthe (clair)', () => {
  expect(css).toMatch(/--accent:\s*#6EE7B7/);
  expect(css).toMatch(/--accent-hover:\s*#34D399/);
  expect(css).toMatch(/--accent-soft:\s*#6ee7b729/);
  expect(css).toMatch(/--accent-ink:\s*#0F7A55/);
  expect(css).toMatch(/--accent-fg:\s*#14322A/);
  expect(css).toMatch(/--success:\s*#16A34A/);
  expect(css).toMatch(/--success-ink:\s*#15803D/);
  expect(css).toMatch(/--warning:\s*#F59E0B/);
  expect(css).not.toMatch(/--accent-soft:\s*#FEF3C7/i);
});

test('globals.css redéfinit l\'encre menthe en sombre, l\'encre succès reste identique (pastilles sur fond doux clair)', () => {
  const dark = css.slice(css.indexOf('.dark'));
  expect(dark).toMatch(/--accent-ink:\s*var\(--brand-mint\)/);
  expect(dark).not.toMatch(/--success-ink\s*:/);
});

test('encre d\'avertissement : jeton --warning-ink (texte sur fond ambre doux), identique en sombre, relié à Tailwind', () => {
  expect(css).toMatch(/--warning-ink:\s*#92400E/);
  const dark = css.slice(css.indexOf('.dark'));
  expect(dark).not.toMatch(/--warning-ink\s*:/);
  const tailwind = readFileSync(join(__dirname, '../../../tailwind.config.ts'), 'utf8');
  expect(tailwind).toMatch(/ink:\s*'var\(--warning-ink\)'/);
});

test('aucune couleur d\'avertissement en dur dans les composants', () => {
  const banner = readFileSync(join(__dirname, '../../components/shell/org-notice-banner.tsx'), 'utf8');
  const pill = readFileSync(join(__dirname, '../../components/organisation/invitations-table.tsx'), 'utf8');
  for (const source of [banner, pill]) {
    expect(source).not.toMatch(/#92400E|#B45309|#FBBF24/i);
    expect(source).toContain('text-warning-ink');
  }
});
