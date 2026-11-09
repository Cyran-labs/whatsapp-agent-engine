import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ERROR_REASONS, TRANSITION_MESSAGES } from '@wabagent/contracts';

// audit R-15 : une clé de ERROR_REASONS que rien n'émet est une promesse sans effet côté web.

const ROOT = resolve(__dirname, '../../..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' || name === 'node_modules' ? [] : sources(path);
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}

describe('clés de refus (error.reason) émises par le moteur', () => {
  const text = [...sources(join(ROOT, 'src')), ...sources(join(ROOT, 'packages/contracts/src'))]
    .filter((path) => !path.endsWith('contracts/src/errors.ts'))
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
  const transitionKeys = Object.keys(TRANSITION_MESSAGES).map((refusal) => `transition.${refusal}`);

  it.each(ERROR_REASONS.filter((key) => !transitionKeys.includes(key)))('%s est levée quelque part', (key) => {
    expect(text).toContain(`'${key}'`);
  });

  it('les clés transition.<refus> sont produites par le gabarit typé du service des agents IA', () => {
    expect(text).toContain('`transition.${reason}`');
  });
});
