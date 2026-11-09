import { createTranslator, type AbstractIntlMessages } from 'next-intl';
import { describe, expect, test } from 'vitest';
import fr from '../../../messages/fr.json';
import en from '../../../messages/en.json';
import type { MutationFailure } from '../api-fetch';
import { describeFailure } from '../describe-failure';

const FALLBACK_FR = 'Enregistrement impossible pour le moment. Réessayez.';
const FALLBACK_EN = 'Could not save right now. Please try again.';

function translator(locale: 'fr' | 'en') {
  const t = createTranslator({ locale, messages: (locale === 'fr' ? fr : en) as AbstractIntlMessages });
  return { t: (key: string) => t(key), has: (key: string) => t.has(key) };
}

function opts(locale: 'fr' | 'en', fields?: readonly string[]) {
  return { fallback: locale === 'fr' ? FALLBACK_FR : FALLBACK_EN, locale, ...translator(locale), ...(fields ? { fields } : {}) };
}

function failure(over: Partial<MutationFailure>): MutationFailure {
  return { error: 'Texte du moteur.', status: 409, details: [], orgChanged: false, reason: null, requestId: null, ...over };
}

describe('describeFailure : tri par statut', () => {
  test('réseau (statut 0) : network et texte contextuel, sans référence', () => {
    expect(describeFailure(failure({ status: 0, error: 'Repli.' }), opts('fr'))).toEqual({
      kind: 'network', message: FALLBACK_FR, fieldErrors: {}, reference: null,
    });
  });

  // audit R-14 : une panne serveur affiche le texte contextuel de l'écran et la référence de la requête, jamais le
  // message technique du moteur.
  test('500 : server, texte contextuel et référence de requête', () => {
    const described = describeFailure(
      failure({ status: 500, error: 'Erreur interne.', requestId: 'req-7f3a', reason: 'member.last_admin' }),
      opts('fr'),
    );
    expect(described).toEqual({ kind: 'server', message: FALLBACK_FR, fieldErrors: {}, reference: 'req-7f3a' });
  });

  // audit R-14
  test('502 sans référence : server, référence nulle', () => {
    expect(describeFailure(failure({ status: 502, error: 'Bad gateway' }), opts('en'))).toEqual({
      kind: 'server', message: FALLBACK_EN, fieldErrors: {}, reference: null,
    });
  });

  test('429 : rate_limited et texte générique, quelle que soit la clé', () => {
    expect(describeFailure(failure({ status: 429, error: 'Trop de requêtes.' }), opts('fr'))).toMatchObject({
      kind: 'rate_limited', message: 'Trop de tentatives. Réessayez dans un instant.', reference: null,
    });
    expect(describeFailure(failure({ status: 429 }), opts('en')).message).toBe('Too many attempts. Please try again shortly.');
  });

  test('401 : session et texte traduit de la clé', () => {
    expect(describeFailure(failure({ status: 401, error: 'Session expirée.', reason: 'session.expired' }), opts('en'))).toEqual({
      kind: 'session', message: 'Session expired.', fieldErrors: {}, reference: null,
    });
  });

  test('403 : forbidden', () => {
    expect(describeFailure(failure({ status: 403, error: 'Accès refusé.' }), opts('fr'))).toMatchObject({
      kind: 'forbidden', message: 'Accès refusé.',
    });
  });

  test('404 : not_found et texte traduit de la clé', () => {
    expect(describeFailure(failure({ status: 404, error: 'Entité introuvable.', reason: 'entity.not_found' }), opts('en'))).toMatchObject({
      kind: 'not_found', message: 'Entity not found.',
    });
  });

  test('409 sans détail de champ : business', () => {
    expect(describeFailure(failure({ status: 409, error: "L'organisation doit garder au moins un admin.", reason: 'member.last_admin' }), opts('fr'))).toEqual({
      kind: 'business', message: "L'organisation doit garder au moins un admin.", fieldErrors: {}, reference: null,
    });
  });

  test('422 avec un détail sur un champ de l\'écran : field', () => {
    const described = describeFailure(
      failure({ status: 422, error: 'Données invalides.', details: [{ path: 'name', message: 'Le nom est requis.' }] }),
      opts('fr', ['name']),
    );
    expect(described).toEqual({ kind: 'field', message: 'Données invalides.', fieldErrors: { name: 'Le nom est requis.' }, reference: null });
  });
});

describe('describeFailure : choix du texte', () => {
  test('clé connue : traduction en anglais', () => {
    expect(describeFailure(failure({ error: "L'organisation doit garder au moins un admin.", reason: 'member.last_admin' }), opts('en')).message).toBe(
      'The organization must keep at least one admin.',
    );
  });

  test('clé connue : traduction en français, au vocabulaire de l\'écran', () => {
    const described = describeFailure(
      failure({ error: 'Ce compte WhatsApp est déconnecté : raccordez un nouveau compte.', reason: 'whatsapp_account.disconnected' }),
      opts('fr'),
    );
    expect(described.message).toBe('Ce compte WhatsApp a été retiré de WABAGENT : raccordez un nouveau compte.');
  });

  // Point d'attention 2 : moteur plus récent que le web, clé inconnue. Français : le texte du moteur. Anglais : le texte
  // contextuel de l'écran, jamais la clé brute.
  test('clé inconnue du web : texte du moteur en français', () => {
    const described = describeFailure(failure({ error: 'Nouvelle règle du moteur.', reason: 'member.future_rule' }), opts('fr'));
    expect(described).toMatchObject({ kind: 'business', message: 'Nouvelle règle du moteur.' });
  });

  test('clé inconnue du web : texte contextuel en anglais, jamais la clé brute', () => {
    const described = describeFailure(failure({ error: 'Nouvelle règle du moteur.', reason: 'member.future_rule' }), opts('en'));
    expect(described.message).toBe(FALLBACK_EN);
    expect(described.message).not.toContain('member.future_rule');
    expect(described.message).not.toContain('errors.reasons');
  });

  test('sans clé : texte du moteur en français, texte contextuel en anglais', () => {
    expect(describeFailure(failure({ error: 'Le nom est requis.' }), opts('fr')).message).toBe('Le nom est requis.');
    expect(describeFailure(failure({ error: 'Le nom est requis.' }), opts('en')).message).toBe(FALLBACK_EN);
  });

  test('clé qui nomme un groupe et non un texte (errors.reasons.member) : traitée comme inconnue', () => {
    const described = describeFailure(failure({ error: 'Texte du moteur.', reason: 'member' }), opts('en'));
    expect(described.message).toBe(FALLBACK_EN);
  });
});

describe('describeFailure : répartition des détails', () => {
  test('détails sur des champs connus dans fieldErrors, les autres ignorés', () => {
    const described = describeFailure(
      failure({
        status: 400,
        error: 'Données invalides.',
        details: [
          { path: 'name', message: 'Le nom est requis.' },
          { path: 'email', message: 'Adresse e-mail invalide.' },
          { path: 'X-Organization-Id', message: 'En-tête requis.' },
        ],
      }),
      opts('fr', ['name', 'email']),
    );
    expect(described.kind).toBe('field');
    expect(described.fieldErrors).toEqual({ name: 'Le nom est requis.', email: 'Adresse e-mail invalide.' });
  });

  test('sans liste de champs : aucun détail en fieldErrors, refus métier', () => {
    const described = describeFailure(
      failure({ status: 400, error: 'Données invalides.', details: [{ path: 'name', message: 'Le nom est requis.' }] }),
      opts('fr'),
    );
    expect(described).toMatchObject({ kind: 'business', fieldErrors: {} });
  });

  test('détail sans message ou au texte du refus : message du refus (traduit si la clé est connue)', () => {
    const engine = 'Entité introuvable ou archivée.';
    const described = describeFailure(
      failure({ status: 400, error: engine, reason: 'bot.entity_unavailable', details: [{ path: 'entity_id', message: engine }, { path: 'name' }] }),
      opts('en', ['entity_id', 'name']),
    );
    expect(described.fieldErrors).toEqual({ entity_id: 'Entity not found or archived.', name: 'Entity not found or archived.' });
  });

  test('détail au texte propre : gardé en français, message du refus en anglais', () => {
    const detail = 'Aucune personnalité ni prompt pour la langue par défaut (fr).';
    const base = failure({ status: 400, error: 'Données invalides.', reason: 'bot.default_language_missing', details: [{ path: 'system_prompt', message: detail }] });
    expect(describeFailure(base, opts('fr', ['system_prompt'])).fieldErrors).toEqual({ system_prompt: detail });
    expect(describeFailure(base, opts('en', ['system_prompt'])).fieldErrors).toEqual({
      system_prompt: 'No personality or prompt for the default language.',
    });
  });

  test('premier détail gardé quand un champ en a plusieurs', () => {
    const described = describeFailure(
      failure({ status: 400, error: 'Données invalides.', details: [{ path: 'name', message: 'Premier.' }, { path: 'name', message: 'Second.' }] }),
      opts('fr', ['name']),
    );
    expect(described.fieldErrors).toEqual({ name: 'Premier.' });
  });

  test('réseau et panne : aucun détail réparti', () => {
    const details = [{ path: 'name', message: 'Le nom est requis.' }];
    expect(describeFailure(failure({ status: 0, details }), opts('fr', ['name'])).fieldErrors).toEqual({});
    expect(describeFailure(failure({ status: 503, details }), opts('fr', ['name'])).fieldErrors).toEqual({});
  });
});
