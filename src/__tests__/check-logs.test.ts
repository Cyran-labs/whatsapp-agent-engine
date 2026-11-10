import { describe, expect, it } from 'vitest';
import { checkSource, checkSourceDetailed, scanEngine, scanWeb } from '../../scripts/check-logs.js';

// Le test vit sous `src/` car vitest ne collecte pas `scripts/` ; la garde est testée par sa fonction pure.

const motifs = (source: string): string[] => checkSource('src/x.ts', source).map((v) => v.motif);

// recette Q-9
describe('check-logs : objet d\'erreur entier', () => {
  it.each([
    ["console.error('[X] échec:', err);"],
    ["console.error('[X] échec:', error);"],
    ["console.warn('[X] échec', e);"],
    ["console.log(err);"],
    ["console.error('[X] échec', dispatchErr);"],
    ["console.error('[X] échec', { err });"],
    ["console.error('[X] échec', { reason: 'x', error: err });"],
    ["console.error('[X] échec', err as Error);"],
    ["console.error('[X] échec', (err as Error));"],
  ])('refuse %s', (line) => {
    expect(motifs(line)).toEqual(["objet d'erreur entier passé à la console"]);
  });

  it('accepte le motif habituel err instanceof Error ? err.message : String(err)', () => {
    expect(motifs("console.error('[X] échec:', err instanceof Error ? err.message : String(err));")).toEqual([]);
    expect(motifs("console.error(`[X] échec: ${err instanceof Error ? err.message : String(err)}`);")).toEqual([]);
    expect(motifs("console.warn(`[X] ${lastError.message}`);")).toEqual([]);
    expect(motifs("console.error('[X] échec', (err as Error).message);")).toEqual([]);
    expect(motifs("console.error('[X] échec', { error: 'x', code: 3 });")).toEqual([]);
  });
});

// recette Q-9
// recette Q-11
describe('check-logs : données de contact et secrets', () => {
  it.each([
    ['responseText', "console.error(`[X] refusé ${responseText.slice(0, 200)}`);"],
    ['profileName', "console.log(`[X] ${profileName}`);"],
    ['fullName', "console.log(`[X] note pour ${fullName}`);"],
    ['link', "console.log(`[X] lien ${link}`);"],
    ['token', "console.log('[X]', token);"],
    ['secret', "console.log(`[X] ${account.secret}`);"],
    ['.phone', "console.log(`[X] (${lead.phone})`);"],
    ['.email', "console.log(`[X] (${lead.email ?? 'x'})`);"],
    ['text', "console.error(`[X] ${text.slice(0, 300)}`);"],
    ['content', "console.log(`[X] ${msg.content}`);"],
    ['trimmed', "console.warn(`[X] ${trimmed.slice(0, 120)}`);"],
    ['providerDetail', "console.error(`[X] ${err.providerDetail}`);"],
    ['phone', "console.log(`[X] ${phone}`);"],
    ['email', "console.log('[X]', email);"],
    ['contactId', "console.log(`[X] ${ctx.contactId}`);"],
    ['rawResponse', "console.log(`[X] ${rawResponse}`);"],
    ['body', "console.log(`[X] ${body}`);"],
    ['payload', "console.log(`[X] ${payload}`);"],
    ['prenom', "console.log(`[X] ${lead.prenom}`);"],
    ['nom', "console.log(`[X] ${lead.nom}`);"],
    ['societe', "console.log(`[X] ${lead.societe}`);"],
    ['invitee_email', "console.log(`[X] ${booking.invitee_email}`);"],
    ['invitee_name', "console.log(`[X] ${booking.invitee_name}`);"],
    ['JSON.stringify', "console.log(`[X] ${JSON.stringify(thing)}`);"],
  ])('refuse %s', (term, line) => {
    expect(motifs(line)).toEqual([`donnée sensible journalisée : ${term}`]);
  });

  it('accepte une donnée passée par maskContact ou maskEmail', () => {
    expect(motifs("console.log(`[X] (${maskEmail(lead.email)})`);")).toEqual([]);
    expect(motifs("console.log(`[X] (${maskLeadContact(lead)})`);")).toEqual([]);
    expect(motifs("console.error(`[X] (${maskContact(booking.phone)})`);")).toEqual([]);
  });

  it('ignore les mots du texte fixe du message', () => {
    expect(motifs("console.warn('[X] Jeton refusé : text, token, secret et link ne sont que du texte');")).toEqual([]);
    expect(motifs('console.warn(`[X] token secret text`);')).toEqual([]);
  });

  it('ne confond pas un identifiant plus long avec un mot interdit', () => {
    expect(motifs('console.log(`[X] ${tokenCount} ${contextual} ${textLength}`);')).toEqual([]);
    expect(motifs('console.log(`[X] ${phoneNumberId} ${bodyParserType} ${nomenclature} ${emailCount} ${payloadSize}`);')).toEqual([]);
    expect(motifs('console.log(`[X] ${botCfg.client_id} ${account.id} ${rawResponse.length}`);')).toEqual(['donnée sensible journalisée : rawResponse']);
  });
});

describe('check-logs : lecture du code', () => {
  it('lit un appel sur plusieurs lignes et donne la ligne de l\'appel', () => {
    const source = ['const a = 1;', 'console.log(', '  `[X] ${a}`,', '  err,', ');'].join('\n');
    expect(checkSource('src/x.ts', source)).toEqual([
      { file: 'src/x.ts', line: 2, motif: "objet d'erreur entier passé à la console" },
    ]);
  });

  it('ignore une mention en commentaire', () => {
    expect(motifs("// console.log('[X]', err);\n/* console.error(token) */")).toEqual([]);
  });

  it('ne refuse qu\'une fois un appel qui cumule deux motifs différents par motif', () => {
    expect(motifs("console.error('[X]', err, `${link}`);")).toEqual([
      "objet d'erreur entier passé à la console",
      'donnée sensible journalisée : link',
    ]);
  });

  it('ne regarde que les méthodes log, info, warn et error', () => {
    expect(motifs('console.debug(token); logger.log(err);')).toEqual([]);
  });
});

describe('check-logs : exemption explicite', () => {
  const exempted = (comment: string): string => `${comment}\nconsole.log(\`[X] ${'${link}'}\`);`;

  it('accepte un appel précédé de check-logs-ignore avec une raison, et la liste', () => {
    const result = checkSourceDetailed('src/x.ts', exempted('// check-logs-ignore: essais en réel, hors production'));
    expect(result.violations).toEqual([]);
    expect(result.exemptions).toEqual([{ file: 'src/x.ts', line: 2, reason: 'essais en réel, hors production' }]);
  });

  it('refuse une exemption sans raison', () => {
    expect(motifs(exempted('// check-logs-ignore:'))).toEqual(['exemption check-logs-ignore sans raison']);
    expect(motifs(exempted('// check-logs-ignore:   '))).toEqual(['exemption check-logs-ignore sans raison']);
  });

  it("n'exempte que la ligne qui suit immédiatement le commentaire", () => {
    expect(motifs(`// check-logs-ignore: raison\nconst a = 1;\nconsole.log(\`[X] ${'${link}'}\`);`)).toEqual([
      'donnée sensible journalisée : link',
    ]);
  });
});

describe('check-logs : moteur', () => {
  it('le code du moteur ne contient aucun appel refusé', () => {
    expect(scanEngine().violations).toEqual([]);
  });

  // Toute nouvelle exemption casse ce test : elle doit être justifiée et ajoutée ici par une décision explicite.
  it("la seule exemption du moteur est la ligne du lien de développement du mailer (choix C-6)", () => {
    const { exemptions } = scanEngine();
    expect(exemptions).toHaveLength(1);
    expect(exemptions[0]).toMatchObject({ file: 'src/core/auth/mailer.ts', reason: expect.stringContaining('C-6') });
  });
});

// tâche 15 : le web (console du navigateur) suit la règle de l'objet d'erreur nu
describe('check-logs : web', () => {
  it("applique la seule règle de l'objet d'erreur aux fichiers du web (les mots sensibles ne sont pas visés)", () => {
    const bare = checkSourceDetailed('apps/web/src/x.tsx', "console.error('[X] échec', err);", { errorObjectsOnly: true });
    expect(bare.violations.map((v) => v.motif)).toEqual(["objet d'erreur entier passé à la console"]);
    const word = checkSourceDetailed('apps/web/src/x.tsx', "console.error(`[X] ${text}`);", { errorObjectsOnly: true });
    expect(word.violations).toEqual([]);
  });

  it('le code du web ne passe aucun objet d\'erreur entier à la console', () => {
    expect(scanWeb().violations).toEqual([]);
  });

  it('le web ne contient aucune exemption', () => {
    expect(scanWeb().exemptions).toEqual([]);
  });
});
