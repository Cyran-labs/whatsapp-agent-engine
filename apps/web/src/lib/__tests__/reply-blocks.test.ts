import { test, expect } from 'vitest';
import { replyBlocks } from '../reply-blocks';

// recette du 12 nov. 2026 (remarques du bilan) : une réponse de l'agent IA avec une liste à puces s'affiche en liste
test('lignes « - » et « • » consécutives : une liste ; le reste en paragraphes, retours à la ligne gardés', () => {
  expect(replyBlocks('Voici nos horaires :\n- lundi 9 h\n• mardi 10 h\n\nÀ bientôt\nL\'équipe')).toEqual([
    { kind: 'text', text: 'Voici nos horaires :' },
    { kind: 'list', items: ['lundi 9 h', 'mardi 10 h'] },
    { kind: 'text', text: '\nÀ bientôt\nL\'équipe' },
  ]);
});

test('texte sans puce : un seul paragraphe, inchangé', () => {
  expect(replyBlocks('Bonjour,\ncomment aider ?')).toEqual([{ kind: 'text', text: 'Bonjour,\ncomment aider ?' }]);
});

test('puce indentée acceptée ; un tiret collé à un mot n\'est pas une puce', () => {
  expect(replyBlocks('  - un\n-deux')).toEqual([{ kind: 'list', items: ['un'] }, { kind: 'text', text: '-deux' }]);
});

test('aucun HTML interprété : le texte reste du texte', () => {
  expect(replyBlocks('- <b>gras</b>')).toEqual([{ kind: 'list', items: ['<b>gras</b>'] }]);
});

test('retours chariot de Windows : lus comme des retours à la ligne', () => {
  expect(replyBlocks('a\r\n- b')).toEqual([{ kind: 'text', text: 'a' }, { kind: 'list', items: ['b'] }]);
});
