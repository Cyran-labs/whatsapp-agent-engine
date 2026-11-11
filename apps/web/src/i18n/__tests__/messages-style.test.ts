import fr from '../../../messages/fr.json';
import en from '../../../messages/en.json';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

const frFlat = flatten(fr as Tree);
const enFlat = flatten(en as Tree);

function offenders(flat: Record<string, string>, pattern: RegExp): string[] {
  return Object.entries(flat)
    .filter(([, value]) => pattern.test(value))
    .map(([key, value]) => `${key} = ${value}`);
}

describe('style des messages', () => {
  test('aucun tiret cadratin ni demi-cadratin (FR et EN)', () => {
    expect(offenders(frFlat, /[\u2014\u2013]/)).toEqual([]);
    expect(offenders(enFlat, /[\u2014\u2013]/)).toEqual([]);
  });

  test('FR : jamais « agent » seul, toujours « agent IA »', () => {
    expect(offenders(frFlat, /\bagents?\b(?!\s+IA)/i)).toEqual([]);
  });

  test('EN : jamais « agent » seul, toujours « AI agent »', () => {
    expect(offenders(enFlat, /(?<!AI )\bagents?\b/i)).toEqual([]);
  });

  test('FR et EN ont exactement les mêmes clés', () => {
    expect(Object.keys(frFlat).sort()).toEqual(Object.keys(enFlat).sort());
  });

  test('FR : aucune esperluette « & » dans un libellé', () => {
    expect(offenders(frFlat, /&/)).toEqual([]);
  });
});

// spec navigation 6.3 et 6.4 : la liste d'accès limité est la « Whitelist » ; « numéros de test » reste au numéro de
// test Meta de Connexions, jamais à la Whitelist.
describe('Whitelist', () => {
  test('FR : ni « accès limité », ni « liste d\'accès », ni « ouvert à tous »', () => {
    expect(offenders(frFlat, /accès limité|liste d'accès/i)).toEqual([]);
    // Seule exception : le bouton de l'assistant sur un numéro de test, dont le texte est fixé mot pour mot par la
    // spec 12.3 et la section 19 n° 34 (décision 131 de l'audit des décisions). L'exception est épinglée à cette clé
    // et à ce texte exact : tout autre « ouvrir à tous » reste refusé.
    const OPEN_TO_ALL_KEY = 'wizard.activate.activateTest';
    expect(frFlat[OPEN_TO_ALL_KEY]).toBe('Activer et ouvrir à tous');
    expect(offenders(frFlat, /ouvr\w* à tous/i).filter((line) => !line.startsWith(`${OPEN_TO_ALL_KEY} = `))).toEqual([]);
  });

  test('FR : « numéros de test » ne désigne jamais la Whitelist', () => {
    expect(offenders(frFlat, /numéros? de test[^.]*Whitelist|Whitelist[^.]*numéros? de test/)).toEqual([]);
    const whitelistKeys = Object.entries(frFlat).filter(([key]) => /allowlist/i.test(key));
    expect(whitelistKeys.filter(([, value]) => /numéros? de test/i.test(value)).map(([key]) => key)).toEqual([]);
  });

  test('EN : jamais « Whitelist » ni « limited access », toujours « Allowlist » là où le français dit « Whitelist »', () => {
    expect(offenders(enFlat, /whitelist|limited access/i)).toEqual([]);
    const missing = Object.entries(frFlat)
      .filter(([, value]) => value.includes('Whitelist'))
      .filter(([key]) => !(enFlat[key] ?? '').includes('Allowlist'))
      .map(([key]) => `${key} = ${enFlat[key]}`);
    expect(missing).toEqual([]);
  });
});

// spec navigation 6.3 (amendement A-15) : sept mots anglais gardés dans l'interface française, noms d'état ou
// d'étiquette, toujours avec leur majuscule, jamais accordés ni conjugués ; en anglais, Whitelist se dit Allowlist.
describe('mots anglais de l\'interface', () => {
  const WORDS = ['Draft', 'Preview', 'Online', 'Offline', 'Whitelist', 'New', 'Soon'];
  const english = (word: string) => (word === 'Whitelist' ? 'Allowlist' : word);

  test.each(WORDS)('FR : « %s » toujours avec sa majuscule, jamais accordé ni conjugué', (word) => {
    expect(offenders(frFlat, new RegExp(`\\b${word.toLowerCase()}\\b`))).toEqual([]);
    expect(offenders(frFlat, new RegExp(`\\b${word}[a-zà-ÿ]+`))).toEqual([]);
  });

  test.each(WORDS)('EN : là où le français dit « %s », l\'anglais dit le même mot avec sa majuscule', (word) => {
    const target = english(word);
    const missing = Object.entries(frFlat)
      .filter(([, value]) => new RegExp(`\\b${word}\\b`).test(value))
      .filter(([key]) => !new RegExp(`\\b${target}\\b`).test(enFlat[key] ?? ''))
      .map(([key]) => `${key} = ${enFlat[key]}`);
    expect(missing).toEqual([]);
    expect(offenders(enFlat, new RegExp(`\\b${target}[a-z]+`))).toEqual([]);
  });

  // revue tâche 14 M-4 (reprend le garde de la revue finale M-3) : un même texte français qui porte un des sept mots a
  // une seule traduction anglaise. Le garde n'est pas étendu à tous les textes : « Connecté » (session ou compte
  // WhatsApp), « Débrancher » (bouton court ou entrée de menu) et « Réessayer » ont des traductions voulues différentes.
  test('un même texte FR qui porte un des sept mots a une seule traduction EN', () => {
    const byFrench = new Map<string, Set<string>>();
    for (const [key, value] of Object.entries(frFlat)) {
      if (!WORDS.some((word) => new RegExp(`\\b${word}\\b`).test(value))) continue;
      const set = byFrench.get(value) ?? new Set<string>();
      set.add(enFlat[key] ?? '');
      byFrench.set(value, set);
    }
    const divergent = [...byFrench].filter(([, translations]) => translations.size > 1).map(([value, translations]) => `${value} = ${[...translations].join(' | ')}`);
    expect(divergent).toEqual([]);
  });

  test('EN : « Allowlist » toujours avec sa majuscule', () => {
    expect(offenders(enFlat, /\ballowlist/)).toEqual([]);
  });
});

// spec navigation 5.4 : un élément à venir porte la pastille « Soon » et la bulle « Disponible prochainement : … ».
describe('éléments à venir (règle Soon)', () => {
  test('FR : ni « à venir », ni « Bientôt », ni « bientôt disponible », ni « Pas encore disponible »', () => {
    expect(offenders(frFlat, /à venir|bientôt|pas encore disponible/i)).toEqual([]);
    expect(offenders(enFlat, /upcoming/i)).toEqual([]);
    // état d'une étape de l'assistant que l'on n'a pas encore atteinte (revue tâche 14 M-3)
    expect(frFlat['wizard.stepState.later']).toBe('pas encore atteinte');
    expect(enFlat['wizard.stepState.later']).toBe('not reached yet');
  });

  // Toute clé sous un segment `soon` (dont `agentSpace.soon.*`) ou qui finit par `Soon`, sauf la pastille elle-même.
  const SOON_KEY = /(^|\.)soon(\.|$)|Soon$/;
  const soonKeys = Object.keys(frFlat).filter((key) => SOON_KEY.test(key) && key !== 'common.soon');

  test('chaque bulle d\'élément à venir dit « Disponible prochainement : » (FR) et « Coming soon: » (EN)', () => {
    expect(soonKeys).toEqual(expect.arrayContaining(['agentSpace.soon.crm', 'connections.crm.soon', 'overview.editPersonalitySoon']));
    for (const key of soonKeys) {
      expect(`${key} = ${frFlat[key]}`).toMatch(/ = Disponible prochainement : /);
      expect(`${key} = ${enFlat[key]}`).toMatch(/ = Coming soon: /);
    }
  });

  test('toute bulle « Disponible prochainement » / « Coming soon » est une clé contrôlée ci-dessus', () => {
    const controlled = new Set(soonKeys);
    expect(offenders(frFlat, /Disponible prochainement/i).filter((line) => !controlled.has(line.split(' = ')[0]))).toEqual([]);
    expect(offenders(enFlat, /Coming soon/i).filter((line) => !controlled.has(line.split(' = ')[0]))).toEqual([]);
  });
});

// spec navigation 6.4 : passe de vocabulaire.
describe('passe de vocabulaire de la navigation', () => {
  test('« Usage et coûts », « Conversations et leads », « Personnaliser et tester » sans esperluette', () => {
    expect(offenders(frFlat, /Usage & coûts|Conversations & Leads|Conversations et Leads|Personnaliser & tester/)).toEqual([]);
    expect(offenders(enFlat, /&/)).toEqual([]);
    expect(frFlat['usage.rail.kicker']).toBe('Usage et coûts');
    expect(frFlat['agentSpace.usage']).toBe('Usage et coûts');
    expect(enFlat['agentSpace.usage']).toBe('Usage and costs');
  });

  test('tokens : « tokens d\'entrée » et « tokens de sortie » partout', () => {
    expect(frFlat['overview.tokensLine']).toBe('{in} tokens d\'entrée · {out} tokens de sortie');
    expect(enFlat['overview.tokensLine']).toBe('{in} input tokens · {out} output tokens');
    expect(frFlat['usage.tokensSplit']).toBe('{in} tokens d\'entrée · {out} tokens de sortie');
    expect(enFlat['usage.tokensSplit']).toBe('{in} input tokens · {out} output tokens');
  });

  // choix P-1 : le moteur compte les messages depuis la création de l'agent IA, sans période.
  test('compteur de messages de la Vue d\'ensemble sans période', () => {
    expect(frFlat['overview.statMessages']).toBe('Messages');
    expect(enFlat['overview.statMessages']).toBe('Messages');
  });

  // Connexions : le menu dit « Retirer le compte », comme le bouton de confirmation ; plus aucun « de WABAGENT ».
  test('compte retiré : « Retirer le compte », jamais « retiré de WABAGENT »', () => {
    expect(frFlat['connections.menu.disconnect']).toBe('Retirer le compte');
    expect(frFlat['connections.disconnect.confirm']).toBe('Retirer le compte');
    expect(enFlat['connections.menu.disconnect']).toBe('Remove account');
    expect(enFlat['connections.disconnect.confirm']).toBe('Remove account');
    // revue tâche 14 M-2 : la notification survit au changement de page, elle nomme le compte WhatsApp
    expect(frFlat['connections.disconnect.done']).toBe('Compte WhatsApp {name} retiré.');
    expect(enFlat['connections.disconnect.done']).toBe('WhatsApp account {name} removed.');
    expect(offenders(frFlat, /WABAGENT/).filter((line) => /retir/i.test(line))).toEqual([]);
    expect(offenders(enFlat, /remov\w*[^.]*from WABAGENT/i)).toEqual([]);
  });

  // revue tâche 14 M-1 : l'état d'un agent IA se dit Online, jamais « en ligne » (contredit Preview, choix P-9).
  test('agent IA jamais « en ligne » (FR) ni « online » en minuscule (EN)', () => {
    expect(offenders(frFlat, /agents? IA[^.]*\ben ligne\b|\ben ligne\b[^.]*agents? IA/)).toEqual([]);
    expect(offenders(enFlat, /AI agents?[^.]*\bonline\b|\bonline\b[^.]*AI agents?/)).toEqual([]);
  });

  test('statut d\'un agent IA : ni « brouillon », ni « désactivé », ni « en pause » (FR)', () => {
    expect(offenders(frFlat, /brouillon|désactivé|en pause/i)).toEqual([]);
  });
});

// revue finale 2b-3 m-5 : une seule formule pour les messages d'échec génériques, « <Action> impossible. Réessayez. »
// en français et « <Action> failed. Please try again. » en anglais (le motif propre à chaque contexte précède).
const GENERIC_FAILURES = [
  'auth.saveError',
  'auth.loginUnavailable',
  'auth.invite.loadError',
  'auth.invite.sessionError',
  'auth.forgot.sendError',
  'wizard.createError',
  'wizard.number.failedReason',
  'wizard.activate.activateFailed',
  'wizard.activate.failedReason',
  'agentStatus.failed',
  'agentAllowlist.failed',
  'connections.dialogs.failed',
  'connections.verify.inconclusive',
  'connections.connectFlow.errors.failed',
  'errors.generic.network',
  'errors.generic.server',
];

describe('messages d\'échec génériques', () => {
  test.each(GENERIC_FAILURES)('%s : « Réessayez. » en FR, « Please try again. » en EN, en phrases séparées', (key) => {
    expect(frFlat[key]).toMatch(/\. [^.]*[Rr]éessayez[^.]*\.$/);
    expect(frFlat[key]).not.toMatch(/[,:;] ?réessayez/i);
    expect(enFlat[key]).toMatch(/\. [^.]*Please try again[^.]*\.$/);
    expect(enFlat[key]).not.toMatch(/[,:;] ?(please )?try again/i);
  });
});

// contre-audit D-8 (écart EN) : en anglais, « Brancher » / « Débrancher » (un numéro sur un agent IA) se disent
// « Assign » / « Unassign », jamais « Connect » / « Disconnect », réservés à « Raccorder » un compte WhatsApp.
describe('vocabulaire anglais du branchement', () => {
  // Messages qui disent aussi « Raccordez le compte » : « Connect » y est le bon mot pour le compte.
  const MIXED = new Set(['connections.emptyText']);

  test('toute clé française sur « brancher » ou « débrancher » dit « assign » ou « unassign » en anglais', () => {
    const wrong: string[] = [];
    for (const [key, value] of Object.entries(frFlat)) {
      if (!/\b(?:d[ée])?branch/i.test(value) || MIXED.has(key)) continue;
      const english = enFlat[key] ?? '';
      if (/\b(?:dis)?connect/i.test(english)) wrong.push(`${key} = ${english}`);
    }
    expect(wrong).toEqual([]);
  });

  test('libellés des actions', () => {
    expect(enFlat['connections.numbers.assign']).toBe('Assign to an AI agent');
    expect(enFlat['connections.numbers.assignShort']).toBe('Assign');
    expect(enFlat['connections.menu.assign']).toBe('Assign to an AI agent');
    expect(enFlat['connections.menu.unassign']).toBe('Unassign from AI agent');
    expect(enFlat['agentNumber.assign']).toBe('Assign a number');
    expect(enFlat['agentNumber.unassign']).toBe('Unassign');
    expect(enFlat['connections.unassign.confirm']).toBe('Unassign AI agent');
    expect(enFlat['connections.connect']).toBe('+ Connect a WhatsApp account');
    expect(enFlat['agentNumber.dialog.connect']).toBe('Connect a WhatsApp account');
  });
});

// revue 18a : brancher un numéro sur un agent IA ne se dit jamais « connecter » en français ni « connect » en anglais ;
// « raccorder » / « connect » restent pour le compte WhatsApp.
describe('vocabulaire du numéro d\'un agent IA', () => {
  test('libellés du numéro et de la mise en route', () => {
    expect(frFlat['agents.notConnected']).toBe('Aucun numéro');
    expect(enFlat['agents.notConnected']).toBe('No number');
    expect(frFlat['success.subtitle']).toContain('il faut lui brancher un numéro WhatsApp puis l\'activer');
    expect(enFlat['success.subtitle']).toContain('Assign it a WhatsApp number then activate it');
    for (const key of ['onboarding.stepConnect', 'agents.stepConnect', 'agents.connectCta']) {
      expect(frFlat[key]).toBe('Brancher un numéro');
      expect(enFlat[key]).toBe('Assign a number');
    }
  });

  test('aucun texte français ne demande de « connecter » un numéro ou un agent IA', () => {
    expect(offenders(frFlat, /\b(?:connecter|connectez)\b[^.]*\b(?:numéro|agent IA|WhatsApp)\b/i)).toEqual([]);
  });
});
