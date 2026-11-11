import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from 'vitest';

const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8');

/** Jetons d'un bloc de globals.css (`:root` ou `.dark`), commentaires retirés. */
function tokens(selector: ':root' | '.dark'): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`bloc ${selector} introuvable`);
  const body = css.slice(start, css.indexOf('}', start)).replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

/** Valeur d'un jeton dans un thème : `.dark` redéfinit `:root`, les `var(--…)` imbriqués sont résolus. */
function resolve(name: string, theme: 'light' | 'dark'): string {
  const root = tokens(':root');
  const dark = theme === 'dark' ? tokens('.dark') : new Map<string, string>();
  let value = dark.get(name) ?? root.get(name);
  for (let depth = 0; value !== undefined && depth < 10; depth++) {
    const ref = /^var\((--[a-z0-9-]+)\)$/.exec(value);
    if (!ref) return value;
    value = dark.get(ref[1]) ?? root.get(ref[1]);
  }
  throw new Error(`jeton ${name} introuvable ou non résolu (${theme})`);
}

/** Luminance relative WCAG 2.1 d'une couleur `#RRGGBB`. */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`couleur opaque attendue : ${hex}`);
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Rapport de contraste WCAG 2.1 entre deux couleurs `#RRGGBB`. */
function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

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

// recette 3.3 : surface sombre validée par François
test('globals.css porte les tokens sombres recalés', () => {
  const dark = tokens('.dark');
  expect(dark.get('--surface')).toBe('#03130e');
  expect(dark.get('--border')).toBe('#1E463B');
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

test('contrastRatio suit WCAG 2.1 (noir sur blanc 21:1, couleur sur elle-même 1:1)', () => {
  expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
  expect(contrastRatio('#14322A', '#14322A')).toBeCloseTo(1, 5);
});

// recette 3.3 : chaque texte du thème sombre est lisible sur chaque fond sombre, sans exception
test.each(['--fg', '--muted', '--muted-2', '--accent-ink'])('thème sombre : %s au moins 4,5:1 sur --surface, --surface-subtle et --bg', (text) => {
  for (const background of ['--surface', '--surface-subtle', '--bg']) {
    const ratio = contrastRatio(resolve(text, 'dark'), resolve(background, 'dark'));
    expect(ratio, `${text} sur ${background} : ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  }
});

// recette 3.3 : gris secondaire sombre éclairci pour tenir 4,5:1 sur --surface-subtle
test('thème sombre : --muted-2 vaut #8A9F95', () => {
  expect(tokens('.dark').get('--muted-2')).toBe('#8A9F95');
});

// spec 3.11 : Offline gris lisible dans les deux thèmes
test.each(['light', 'dark'] as const)('Offline (%s) : --offline-ink au moins 4,5:1 sur --offline-soft', (theme) => {
  const ratio = contrastRatio(resolve('--offline-ink', theme), resolve('--offline-soft', theme));
  expect(ratio, `${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
});

test('jetons Offline : valeurs claires et sombres, reliés à Tailwind', () => {
  expect(tokens(':root').get('--offline-soft')).toBe('#ECEFED');
  expect(tokens(':root').get('--offline-ink')).toBe('#5B6660');
  expect(tokens('.dark').get('--offline-soft')).toBe('#1F2925');
  expect(tokens('.dark').get('--offline-ink')).toBe('#B3BDB8');
  const tailwind = readFileSync(join(__dirname, '../../../tailwind.config.ts'), 'utf8');
  expect(tailwind).toMatch(/offline:\s*\{\s*soft:\s*'var\(--offline-soft\)',\s*ink:\s*'var\(--offline-ink\)'\s*\}/);
});

// revue I-1, I-2 et M-2 : paires texte et fond posées par les composants corrigés, dans les deux thèmes
test.each([
  ['--danger-ink', '--danger-soft'], // bulle et libellé « Non envoyé » du simulateur
  ['--muted', '--surface'], // placeholder du champ du simulateur
  ['--fg', '--surface-subtle'], // champs à collecter de l'assistant, bandeau « Simulation », initiales
  ['--muted', '--surface-subtle'], // recette 3.7 : raison d'un agent IA non choisissable dans « Brancher le numéro »
] as const)('%s sur %s au moins 4,5:1 dans les deux thèmes', (text, background) => {
  for (const theme of ['light', 'dark'] as const) {
    const ratio = contrastRatio(resolve(text, theme), resolve(background, theme));
    expect(ratio, `${theme} : ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  }
});

// recette 3.4, recette 3.5 (C-11) : paires posées par les marques de « Ne répond pas », dans les deux thèmes
test.each([
  ['--danger-ink', '--danger-soft'], // étiquette « Ne répond pas » de Santé, encadré rouge de l'encart Statut
  ['--muted', '--surface'], // étiquette neutre « Whitelist vide », invitation de l'encadré neutre
  ['--fg', '--surface'], // titre « Whitelist vide » de l'encadré neutre
] as const)('marques de la mention : %s sur %s au moins 4,5:1 dans les deux thèmes', (text, background) => {
  for (const theme of ['light', 'dark'] as const) {
    const ratio = contrastRatio(resolve(text, theme), resolve(background, theme));
    expect(ratio, `${theme} : ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  }
});

// recette 3.4 : le point rouge est un élément graphique (WCAG 1.4.11), au moins 3:1 sur son liseré --surface
test.each(['light', 'dark'] as const)('point « Ne répond pas » (%s) : --danger au moins 3:1 sur --surface', (theme) => {
  const ratio = contrastRatio(resolve('--danger', theme), resolve('--surface', theme));
  expect(ratio, `${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
});
