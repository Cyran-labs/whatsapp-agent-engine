/**
 * Suite d'isolation « deux organisations », lot « Refonte de la navigation » : ce que la navigation lit du moteur
 * (mention « Ne répond pas », vues de Connexions) ne passe jamais d'une organisation à l'autre. Tout passe par le vrai
 * chemin HTTP de l'API d'administration. Seuls le LLM, `fetch` et les clients des fournisseurs sont simulés (harness.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../llm/anthropic.js', async () => (await import('./llm-mock.js')).llmMockModule());

import { ACME_NUMBER, BETA_CM_NUMBER, BETA_NUMBER, PNID_A, PNID_B, WABA_A, WABA_B, setupTwoOrgs } from './harness.js';
import type { TwoOrgs } from './harness.js';

interface BotJson { bot_id: string; client_id: string; not_responding: string | null }

describe('isolation entre deux organisations : navigation (chemin HTTP réel)', () => {
  let world: TwoOrgs;

  beforeEach(async () => {
    world = await setupTwoOrgs();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await world.close();
  });

  // nav 15.1
  it("compte Meta de beta en erreur : la mention est chez beta seulement, aucune réponse d'acme ne nomme beta", async () => {
    const acme = await world.api('acme');
    const beta = await world.api('beta');
    expect(await world.db.setWhatsAppAccountError(world.accounts.beta.account.id, 'token_invalid', 'Jeton refusé')).toBe(true);

    const acmeBots = await acme.get('/bots');
    expect(acmeBots.status).toBe(200);
    expect((acmeBots.body as BotJson[]).map((b) => [b.client_id, b.bot_id, b.not_responding])).toEqual([['acme', 'ventes', null]]);
    expect((await acme.get('/bots/ventes')).body).toMatchObject({ bot_id: 'ventes', not_responding: null });

    const accueil = await beta.get('/bots/accueil');
    expect(accueil.status).toBe(200);
    expect(accueil.body).toMatchObject({ client_id: 'beta', bot_id: 'accueil', not_responding: 'account_not_connected' });
    // Le compte CM.com de beta reste connecté : son agent IA n'a pas la mention.
    expect((await beta.get('/bots/cm')).body).toMatchObject({ bot_id: 'cm', not_responding: null });
    const betaAccount = await beta.get(`/whatsapp-accounts/${world.accounts.beta.account.id}`);
    expect(betaAccount.body.numbers[0].bot).toMatchObject({ bot_id: 'accueil', not_responding: 'account_not_connected' });

    // Témoin : sans `not_responding` dans les réponses d'acme, l'absence de mention ci-dessus serait aveugle.
    const acmeAccount = await acme.get(`/whatsapp-accounts/${world.accounts.acme.account.id}`);
    expect(acmeAccount.body.numbers[0].bot).toEqual({ bot_id: 'ventes', name: 'ventes', status: 'active', status_reason: null, not_responding: null });

    const betaMarks = ['beta', 'accueil', BETA_NUMBER, BETA_CM_NUMBER, WABA_B, PNID_B, 'Jeton refusé'];
    for (const [what, res] of [
      ['liste des agents IA', acmeBots],
      ['agent IA', await acme.get('/bots/ventes')],
      ['liste des comptes', await acme.get('/whatsapp-accounts')],
      ['vue du compte', acmeAccount],
    ] as const) {
      const json = JSON.stringify(res.body);
      expect([what, betaMarks.filter((m) => json.includes(m))]).toEqual([what, []]);
    }
    // Agent IA de beta lu par acme : 404, comme un agent IA inconnu.
    expect((await acme.get('/bots/accueil')).status).toBe(404);
  });
  // nav 15.1 : cas symétrique (revue tâche 1, M-5), le calcul ne prend jamais « l'autre » organisation.
  it("compte Meta d'acme en erreur : la mention est chez acme seulement, aucun agent IA de beta ne l'a", async () => {
    const acme = await world.api('acme');
    const beta = await world.api('beta');
    expect(await world.db.setWhatsAppAccountError(world.accounts.acme.account.id, 'token_invalid', 'Jeton refusé')).toBe(true);

    expect((await acme.get('/bots/ventes')).body).toMatchObject({ client_id: 'acme', bot_id: 'ventes', not_responding: 'account_not_connected' });

    const betaBots = await beta.get('/bots');
    expect(betaBots.status).toBe(200);
    expect((betaBots.body as BotJson[]).map((b) => [b.client_id, b.bot_id, b.not_responding]).sort()).toEqual([
      ['beta', 'accueil', null], ['beta', 'cm', null],
    ]);
    const betaAccounts = await beta.get('/whatsapp-accounts');
    expect((betaAccounts.body as Array<{ numbers: Array<{ bot: { not_responding: string | null } | null }> }>)
      .flatMap((a) => a.numbers.map((n) => n.bot?.not_responding))).toEqual([null, null]);

    const acmeMarks = ['acme', 'ventes', ACME_NUMBER, WABA_A, PNID_A, 'Jeton refusé'];
    for (const [what, res] of [
      ['liste des agents IA', betaBots],
      ['agent IA', await beta.get('/bots/accueil')],
      ['liste des comptes', betaAccounts],
    ] as const) {
      const json = JSON.stringify(res.body);
      expect([what, acmeMarks.filter((m) => json.includes(m))]).toEqual([what, []]);
    }
    expect((await beta.get('/bots/ventes')).status).toBe(404);
  });
});
