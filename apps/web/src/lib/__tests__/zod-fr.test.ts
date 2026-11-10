import { test, expect } from 'vitest';
import { z } from 'zod';
import { zodIssueToFrench } from '../zod-fr';

function firstIssue(schema: z.ZodTypeAny, value: unknown): z.ZodIssue {
  const parsed = schema.safeParse(value);
  if (parsed.success) throw new Error('le schéma aurait dû refuser la valeur');
  return parsed.error.issues[0]!;
}

// audit R-7
test('un message écrit dans les contrats est gardé tel quel', () => {
  expect(zodIssueToFrench(firstIssue(z.string().min(1, 'Le nom est requis.'), ''))).toBe('Le nom est requis.');
  expect(zodIssueToFrench(firstIssue(z.string().refine(() => false, { message: 'Refusé par la règle.' }), 'x'))).toBe('Refusé par la règle.');
});

// audit R-7
test('message Zod par défaut : texte français par type', () => {
  expect(zodIssueToFrench(firstIssue(z.string().min(2), 'a'))).toBe('Valeur trop courte.');
  expect(zodIssueToFrench(firstIssue(z.string().max(2), 'abc'))).toBe('Valeur trop longue.');
  expect(zodIssueToFrench(firstIssue(z.string().email(), 'pas un e-mail'))).toBe('Format invalide.');
  expect(zodIssueToFrench(firstIssue(z.string(), undefined))).toBe('Valeur manquante ou invalide.');
  expect(zodIssueToFrench(firstIssue(z.number(), 'x'))).toBe('Valeur manquante ou invalide.');
  expect(zodIssueToFrench(firstIssue(z.enum(['a', 'b']), 'c'))).toBe('Valeur invalide.');
  expect(zodIssueToFrench(firstIssue(z.number().refine(() => false), 1))).toBe('Valeur invalide.');
});

// audit R-7
test('aucun texte français renvoyé ne contient un message anglais de Zod', () => {
  const issues = [
    firstIssue(z.string().min(2), 'a'),
    firstIssue(z.string().max(2), 'abc'),
    firstIssue(z.string().email(), 'x'),
    firstIssue(z.string(), undefined),
    firstIssue(z.array(z.string()).min(1), []),
    firstIssue(z.object({ a: z.string() }).strict(), { a: 'x', b: 1 }),
    firstIssue(z.literal('a'), 'b'),
  ];
  for (const issue of issues) expect(zodIssueToFrench(issue)).not.toMatch(/String must|Invalid|Expected|Required|Array must/);
});
