/**
 * Suite d'isolation « deux organisations », lot « Refonte de la navigation » : ce que la navigation lit du moteur
 * (mention « Ne répond pas », vues de Connexions) ne passe jamais d'une organisation à l'autre. Tout passe par le vrai
 * chemin HTTP de l'API d'administration. Seuls le LLM, `fetch` et les clients des fournisseurs sont simulés (harness.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../llm/anthropic.js', async () => (await import('./llm-mock.js')).llmMockModule());

import { BETA_CM_NUMBER, BETA_NUMBER, PNID_B, WABA_B, setupTwoOrgs } from './harness.js';
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
});
