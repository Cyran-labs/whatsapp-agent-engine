import { describe, expect, it } from 'vitest';
import { CLAUDE_CHAT_MODELS } from '@wabagent/contracts';
import { CHAT_EFFORT, CHAT_MODEL_CASCADE, LEAD_EXTRACTION_MODEL, CALLABLE_MODELS, readReply } from '../models.js';

describe('modèles Claude du moteur', () => {
  it('cascade de conversation : Sonnet 5.5, puis Sonnet 5, puis Haiku 5.5', () => {
    expect(CHAT_MODEL_CASCADE.map((p) => p.model)).toEqual(['claude-sonnet-5-5', 'claude-sonnet-5', 'claude-haiku-5-5']);
    expect(CHAT_MODEL_CASCADE.map((p) => p.plan)).toEqual(['A', 'B', 'C']);
    // Une seule liste de référence : la cascade suit le contrat partagé avec le back-office.
    expect(CHAT_MODEL_CASCADE.map((p) => p.model)).toEqual([...CLAUDE_CHAT_MODELS]);
  });

  it('effort bas pour les réponses WhatsApp, extraction de lead sur Haiku 5.5', () => {
    expect(CHAT_EFFORT).toBe('low');
    expect(LEAD_EXTRACTION_MODEL).toBe('claude-haiku-5-5');
  });

  it('modèles appelables : la cascade et le modèle d\'extraction, sans doublon ni modèle retiré', () => {
    expect(new Set(CALLABLE_MODELS)).toEqual(new Set(['claude-sonnet-5-5', 'claude-sonnet-5', 'claude-haiku-5-5']));
    for (const m of CALLABLE_MODELS) expect(m).not.toMatch(/claude-(sonnet|haiku)-4/);
  });
});

describe('lecture d\'une réponse Claude', () => {
  it('réponse simple : le texte', () => {
    expect(readReply({ content: [{ type: 'text', text: 'Bonjour' }], stop_reason: 'end_turn' }))
      .toEqual({ kind: 'text', text: 'Bonjour', truncated: false });
  });

  it('bloc de réflexion en tête (réglage par défaut des modèles 5.5) : il est ignoré, le texte est lu', () => {
    const r = readReply({
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Bonjour !' }],
      stop_reason: 'end_turn',
    });
    expect(r).toEqual({ kind: 'text', text: 'Bonjour !', truncated: false });
  });

  it('plusieurs blocs de texte : ils sont joints dans l\'ordre', () => {
    const r = readReply({ content: [{ type: 'text', text: 'Un.' }, { type: 'thinking' }, { type: 'text', text: ' Deux.' }], stop_reason: 'end_turn' });
    expect(r).toEqual({ kind: 'text', text: 'Un. Deux.', truncated: false });
  });

  it('refus de sécurité : signalé avec sa catégorie, aucun texte retenu', () => {
    const r = readReply({
      content: [{ type: 'text', text: 'partiel' }], stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'cyber', explanation: 'x' },
    });
    expect(r).toEqual({ kind: 'refusal', category: 'cyber' });
    expect(readReply({ content: [], stop_reason: 'refusal' })).toEqual({ kind: 'refusal', category: null });
  });

  it('réponse tronquée par la limite de jetons : texte gardé, troncature signalée', () => {
    expect(readReply({ content: [{ type: 'text', text: 'Début' }], stop_reason: 'max_tokens' }))
      .toEqual({ kind: 'text', text: 'Début', truncated: true });
  });

  it('aucun texte (réflexion seule, limite atteinte) : réponse vide, jamais un texte de remplacement', () => {
    expect(readReply({ content: [{ type: 'thinking', thinking: '' }], stop_reason: 'max_tokens' })).toEqual({ kind: 'empty' });
    expect(readReply({ content: [{ type: 'text', text: '   ' }], stop_reason: 'end_turn' })).toEqual({ kind: 'empty' });
  });
});
