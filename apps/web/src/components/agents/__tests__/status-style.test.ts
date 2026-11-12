import { BOT_STATUSES } from '@wabagent/contracts';
import { DANGER_MARK, MENTION_STYLE, NEUTRAL_MARK, STATUS_STYLE } from '../status-style';

// Jetons de couleur déclarés dans le thème (tailwind.config.ts) : une classe de couleur doit en nommer un.
const TOKENS = [
  'bg', 'surface', 'surface-subtle', 'fg', 'muted', 'muted-2', 'border', 'border-strong',
  'accent', 'accent-soft', 'accent-ink', 'brand', 'brand-deep', 'brand-mint',
  'success', 'success-soft', 'success-ink', 'danger', 'danger-soft', 'danger-ink',
  'warning', 'warning-soft', 'warning-ink', 'offline-soft', 'offline-ink', 'current', 'transparent',
];

function colorClasses(classes: string): string[] {
  return classes.split(/\s+/).filter((c) => /^(bg|text|border)-/.test(c) && !/^border(-\d|$)/.test(c) && !/^text-(xs|sm|\[)/.test(c));
}

test('une entrée par statut du moteur, rien de plus', () => {
  expect(Object.keys(STATUS_STYLE).sort()).toEqual([...BOT_STATUSES].sort());
});

test('couleurs de la spec 6.2 : Online menthe (success), Preview ambre (warning), mention rouge (danger)', () => {
  expect(STATUS_STYLE.active.pill).toContain('bg-success-soft');
  expect(STATUS_STYLE.active.dot).toContain('bg-success');
  expect(STATUS_STYLE.limited.pill).toContain('bg-warning-soft');
  expect(STATUS_STYLE.limited.dot).toContain('bg-warning');
  expect(MENTION_STYLE.pill).toContain('text-danger-ink');
  expect(MENTION_STYLE.dot).toContain('bg-danger');
});

test('Draft et Offline (P-5) : deux gris distinguables, Draft en contour', () => {
  expect(STATUS_STYLE.draft.pill).toContain('bg-surface');
  expect(STATUS_STYLE.draft.pill).toContain('border-border-strong');
  expect(STATUS_STYLE.draft.pill).toContain('text-muted');
  expect(STATUS_STYLE.draft.dot).toContain('bg-transparent');
  // spec 3.11 : Offline gris dans les deux thèmes, jetons dédiés, plus le fond --surface-subtle (vert en sombre)
  expect(STATUS_STYLE.paused.pill).toContain('bg-offline-soft');
  expect(STATUS_STYLE.paused.pill).toContain('text-offline-ink');
  expect(STATUS_STYLE.paused.dot).toContain('bg-offline-ink');
  expect(STATUS_STYLE.paused.pill).not.toContain('surface-subtle');
  expect(STATUS_STYLE.draft.pill).not.toEqual(STATUS_STYLE.paused.pill);
  expect(STATUS_STYLE.draft.dot).not.toEqual(STATUS_STYLE.paused.dot);
  // Draft n'est plus menthe (spec 6.2)
  expect(STATUS_STYLE.draft.pill).not.toMatch(/accent|success/);
});

test('jetons du thème seulement : aucune couleur codée en dur', () => {
  const all = [...[...Object.values(STATUS_STYLE), MENTION_STYLE].flatMap((s) => [s.pill, s.dot]), DANGER_MARK, NEUTRAL_MARK];
  for (const classes of all) {
    expect(classes).not.toMatch(/#[0-9a-f]{3,8}|rgb|\[/i);
    for (const c of colorClasses(classes)) {
      expect(TOKENS).toContain(c.replace(/^(bg|text|border)-/, ''));
    }
  }
});

// recette 3.4, recette 3.5 (C-11) : point rouge à liseré de la surface ; Whitelist vide en étiquette neutre, sans rouge
test('marques de « Ne répond pas » : point danger, étiquette neutre', () => {
  expect(DANGER_MARK).toContain('bg-danger');
  expect(DANGER_MARK).toContain('ring-surface');
  expect(NEUTRAL_MARK).toBe('border border-border-strong bg-surface text-muted');
  expect(NEUTRAL_MARK).not.toMatch(/danger|warning/);
});
