import { createTranslator } from 'next-intl';
import { describe, expect, test } from 'vitest';
import { ERROR_REASONS } from '@wabagent/contracts';
import fr from '../../../messages/fr.json';
import en from '../../../messages/en.json';

type Tree = { [key: string]: string | Tree };

function leaf(tree: Tree, path: string): string | undefined {
  let node: string | Tree | undefined = tree;
  for (const part of path.split('.')) {
    if (node === undefined || typeof node === 'string') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

const catalogs = { fr: fr as Tree, en: en as Tree };

// audit R-15 : chaque refus qui porte une clé stable a son texte en français et en anglais ; une clé ajoutée aux
// contrats sans traduction casse ce test.
describe.each(['fr', 'en'] as const)('errors.reasons (%s)', (locale) => {
  test.each([...ERROR_REASONS])('%s a un texte', (reason) => {
    const text = leaf(catalogs[locale], `errors.reasons.${reason}`);
    expect(text, `errors.reasons.${reason} absent en ${locale}`).toBeTypeOf('string');
    expect(text?.trim()).not.toBe('');
    // Le texte se lit tel quel : aucun argument ICU à fournir, aucune balise.
    const t = createTranslator({ locale, messages: catalogs[locale] });
    expect(t(`errors.reasons.${reason}`)).toBe(text);
  });

  test('aucune clé de traduction hors des clés des contrats', () => {
    const reasons = (catalogs[locale].errors as Tree).reasons as Tree;
    const translated = Object.entries(reasons).flatMap(([domain, cases]) =>
      typeof cases === 'string' ? [domain] : Object.keys(cases).map((c) => `${domain}.${c}`),
    );
    expect(translated.sort()).toEqual([...ERROR_REASONS].sort());
  });
});

describe('textes génériques', () => {
  // Même texte que la page de connexion (auth.rateLimited) : une seule formule pour « trop de tentatives ».
  test.each(['fr', 'en'] as const)('errors.generic.rateLimited = auth.rateLimited (%s)', (locale) => {
    expect(leaf(catalogs[locale], 'errors.generic.rateLimited')).toBe(leaf(catalogs[locale], 'auth.rateLimited'));
  });

  test.each(['fr', 'en'] as const)('errors.generic.reference cite la référence (%s)', (locale) => {
    const t = createTranslator({ locale, messages: catalogs[locale] });
    expect(t('errors.generic.reference', { reference: 'req-1' })).toContain('req-1');
  });

  test('textes français attendus', () => {
    expect(leaf(catalogs.fr, 'errors.generic.reference')).toBe('Référence : {reference}');
    expect(leaf(catalogs.fr, 'errors.generic.invalidField')).toBe('Vérifiez ce champ.');
    expect(leaf(catalogs.en, 'errors.generic.invalidField')).toBe('Check this field.');
    expect(leaf(catalogs.fr, 'errors.generic.forbidden')).toBe("Vous n'avez pas les droits pour cette action.");
    expect(leaf(catalogs.en, 'errors.generic.forbidden')).toBe("You don't have permission for this action.");
    expect(leaf(catalogs.fr, 'actions.manage')).toBe('Gérer');
    expect(leaf(catalogs.en, 'actions.manage')).toBe('Manage');
  });
});
