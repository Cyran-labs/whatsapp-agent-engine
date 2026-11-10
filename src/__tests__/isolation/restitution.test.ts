/**
 * Suite d'isolation « deux organisations », lot « Restitution des erreurs et vocabulaire » : ce que l'interface
 * affiche d'une erreur ne doit jamais passer d'une organisation à l'autre. Tout passe par le vrai chemin HTTP de l'API
 * d'administration (session, organisation active). Seuls le LLM, `fetch` et les clients des fournisseurs sont
 * simulés (harness.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../llm/anthropic.js', async () => (await import('./llm-mock.js')).llmMockModule());

import { SHARED_CONTACT, setupTwoOrgs } from './harness.js';
import type { TwoOrgs } from './harness.js';

const MARK_BETA = 'MARQUEUR-TEXTE-FOURNISSEUR-BETA';
const MARK_ACME = 'MARQUEUR-TEXTE-FOURNISSEUR-ACME';

describe("isolation entre deux organisations : restitution des erreurs (chemin HTTP réel)", () => {
  let world: TwoOrgs;

  beforeEach(async () => {
    world = await setupTwoOrgs();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await world.close();
  });

  /** La prochaine vérification Meta d'un compte échoue avec ce texte brut du fournisseur. */
  function nextVerifyFails(mark: string): void {
    const verifyMeta = world.providers.verifyMeta as unknown as { mockImplementationOnce(fn: () => Promise<unknown>): void };
    verifyMeta.mockImplementationOnce(async () => ({
      ok: false,
      checks: [{ key: 'token', status: 'failed', detail: 'Meta a renvoyé une erreur', provider_text: mark }],
      error_reason: 'other',
      message: 'Meta a renvoyé une erreur',
      provider_text: mark,
    }));
  }

  // revue isolation restitution I-1
  it("compte de beta en erreur avec un provider_text : absent de toute réponse d'acme, effacé par une vérification réussie", async () => {
    const acme = await world.api('acme');
    const beta = await world.api('beta');
    const betaId = world.accounts.beta.account.id;
    const acmeId = world.accounts.acme.account.id;

    nextVerifyFails(MARK_BETA);
    const failed = await beta.post(`/whatsapp-accounts/${betaId}/verify`);
    expect(failed.status).toBe(200);
    expect(failed.body).toMatchObject({ state: 'error', provider_text: MARK_BETA });
    expect((await world.db.getWhatsAppAccount('beta', betaId))?.error_provider_text).toBe(MARK_BETA);

    // Témoin : acme voit bien son propre texte du fournisseur, donc l'absence ci-dessous n'est pas un test aveugle.
    nextVerifyFails(MARK_ACME);
    const acmeFailed = await acme.post(`/whatsapp-accounts/${acmeId}/verify`);
    expect(acmeFailed.body).toMatchObject({ state: 'error', provider_text: MARK_ACME });
    expect((await acme.get(`/whatsapp-accounts/${acmeId}`)).body.provider_text).toBe(MARK_ACME);

    const noBeta = (what: string, res: { body: unknown }): void =>
      expect([what, JSON.stringify(res.body).includes(MARK_BETA)]).toEqual([what, false]);

    // Lectures d'acme : liste, vue de son compte, webhook, ses agents IA, sa session.
    noBeta('liste des comptes', await acme.get('/whatsapp-accounts'));
    noBeta('vue du compte', await acme.get(`/whatsapp-accounts/${acmeId}`));
    noBeta('webhook du compte', await acme.get(`/whatsapp-accounts/${acmeId}/webhook`));
    noBeta('liste des agents IA', await acme.get('/bots'));
    noBeta('agent IA', await acme.get('/bots/ventes'));
    noBeta('santé de l\'agent IA', await acme.get('/bots/ventes/health'));
    noBeta('session', await acme.get('/auth/me'));
    // Écritures d'acme sur son propre compte : réponses de vérification et de rafraîchissement.
    noBeta('vérification de son compte', await acme.post(`/whatsapp-accounts/${acmeId}/verify`));
    noBeta('rafraîchissement de ses numéros', await acme.post(`/whatsapp-accounts/${acmeId}/refresh-numbers`));
    noBeta('liste après vérification', await acme.get('/whatsapp-accounts'));

    // Routes d'acme visant le compte de beta : 404 sans texte du fournisseur, et rien d'écrit chez beta.
    for (const [what, res] of [
      ['lecture du compte de beta', await acme.get(`/whatsapp-accounts/${betaId}`)],
      ['webhook du compte de beta', await acme.get(`/whatsapp-accounts/${betaId}/webhook`)],
      ['vérification du compte de beta', await acme.post(`/whatsapp-accounts/${betaId}/verify`)],
      ['rafraîchissement du compte de beta', await acme.post(`/whatsapp-accounts/${betaId}/refresh-numbers`)],
    ] as const) {
      expect([what, res.status]).toEqual([what, 404]);
      noBeta(what, res);
    }
    const betaStored = await world.db.getWhatsAppAccount('beta', betaId);
    expect(betaStored).toMatchObject({ state: 'error', error_provider_text: MARK_BETA });

    // Vérification réussie chez beta : le texte du fournisseur est effacé, dans la réponse, la vue et la base.
    const ok = await beta.post(`/whatsapp-accounts/${betaId}/verify`);
    expect(ok.body).toMatchObject({ state: 'connected', provider_text: null, error_detail: null, error_cause: null });
    expect((await beta.get(`/whatsapp-accounts/${betaId}`)).body.provider_text).toBeNull();
    expect((await world.db.getWhatsAppAccount('beta', betaId))?.error_provider_text).toBeNull();
    expect(JSON.stringify((await beta.get('/whatsapp-accounts')).body)).not.toContain(MARK_BETA);
  });

  // revue isolation restitution I-2
  it("agent IA de beta vu par acme et agent IA inexistant : même statut, même texte, même clé bot.not_found, rien d'écrit chez beta", async () => {
    const acme = await world.api('acme');
    const BETA_BOT = 'accueil';
    const MISSING = 'inexistant';
    const acmeNumberId = world.accounts.acme.numbers[Object.keys(world.accounts.acme.numbers)[0]!]!.id;
    const betaNumberId = world.accounts.beta.numbers[Object.keys(world.accounts.beta.numbers)[0]!]!.id;
    const allowed = '+33612345678';

    type Call = (botId: string) => Promise<{ status: number; body: { error?: Record<string, unknown> } }>;
    const routes: Array<[string, Call]> = [
      ['GET /bots/:id', (b) => acme.get(`/bots/${b}`)],
      ['PATCH /bots/:id', (b) => acme.patch(`/bots/${b}`, { name: 'x' })],
      ['PUT /bots/:id/status', (b) => acme.put(`/bots/${b}/status`, { status: 'paused' })],
      ['PUT /bots/:id/allowlist (liste vide)', (b) => acme.put(`/bots/${b}/allowlist`, { entries: [] })],
      ['PUT /bots/:id/allowlist', (b) => acme.put(`/bots/${b}/allowlist`, { entries: [allowed] })],
      ['POST /bots/:id/number/unassign', (b) => acme.post(`/bots/${b}/number/unassign`, { expected_number_id: betaNumberId })],
      ['PUT /bots/:id/number (agent IA de beta)', (b) => acme.put(`/bots/${b}/number`, { number_id: acmeNumberId, expected_bot_id: 'ventes' })],
      ['POST /bots/:id/activate (agent IA de beta)', (b) => acme.post(`/bots/${b}/activate`, { number_id: acmeNumberId, expected_bot_id: 'ventes', status: 'active' })],
      ['GET /bots/:id/health', (b) => acme.get(`/bots/${b}/health`)],
      ['GET /bots/:id/metrics', (b) => acme.get(`/bots/${b}/metrics`)],
      ['GET /bots/:id/usage', (b) => acme.get(`/bots/${b}/usage`)],
      ['GET /bots/:id/leads', (b) => acme.get(`/bots/${b}/leads`)],
      ['GET /bots/:id/leads/:contact', (b) => acme.get(`/bots/${b}/leads/${SHARED_CONTACT}`)],
      ['GET /bots/:id/llm', (b) => acme.get(`/bots/${b}/llm`)],
      ['PUT /bots/:id/llm', (b) => acme.put(`/bots/${b}/llm`, { mode: 'platform' })],
      ['POST /bots/:id/simulate', (b) => acme.post(`/bots/${b}/simulate`, { message: 'x' })],
      ['GET /bots/:id/crm/hubspot', (b) => acme.get(`/bots/${b}/crm/hubspot`)],
      ['PUT /bots/:id/crm/hubspot', (b) => acme.put(`/bots/${b}/crm/hubspot`, { values: { access_token: 'pat-x' } })],
      ['POST /bots/:id/crm/hubspot/validate', (b) => acme.post(`/bots/${b}/crm/hubspot/validate`)],
      ['GET /bots/:id/mappings/hubspot', (b) => acme.get(`/bots/${b}/mappings/hubspot`)],
      ['PUT /bots/:id/mappings/hubspot', (b) => acme.put(`/bots/${b}/mappings/hubspot`, { version: 1, connector: 'hubspot', target_object: 'contact', client_id: 'acme', field_mapping: [{ source: 'name', target: 'firstname' }] })],
    ];

    const snapshot = async () => ({
      record: await world.db.getBotRecord('beta', BETA_BOT),
      allowlist: await world.db.getAllowlist('beta', BETA_BOT),
      number: await world.db.getWhatsAppNumberForBot('beta', BETA_BOT),
      runtime: await world.db.getBotRuntimeState('beta', BETA_BOT),
      acmeBotNumber: await world.db.getWhatsAppNumberForBot('acme', 'ventes'),
    });
    const before = await snapshot();
    expect(before.record).toBeDefined();
    expect(before.number).toBeDefined();

    const shape = (res: Awaited<ReturnType<Call>>) => ({
      status: res.status,
      code: res.body.error?.['code'],
      message: res.body.error?.['message'],
      reason: res.body.error?.['reason'],
      details: res.body.error?.['details'],
    });

    const diffs: string[] = [];
    const notBotNotFound: string[] = [];
    let compared = 0;
    for (const [label, call] of routes) {
      const foreign = shape(await call(BETA_BOT));
      const missing = shape(await call(MISSING));
      compared += 1;
      if (JSON.stringify(foreign) !== JSON.stringify(missing)) diffs.push(`${label}: beta=${JSON.stringify(foreign)} inexistant=${JSON.stringify(missing)}`);
      if (foreign.status < 400) diffs.push(`${label}: réussite sur l'agent IA de beta (${foreign.status})`);
      // Toute route qui répond « Agent IA introuvable. » le fait avec la clé bot.not_found, pour l'un comme pour l'autre.
      if (missing.message === 'Agent IA introuvable.' && (foreign.reason !== 'bot.not_found' || missing.reason !== 'bot.not_found')) {
        notBotNotFound.push(`${label}: beta=${String(foreign.reason)} inexistant=${String(missing.reason)}`);
      }
    }
    expect(compared).toBe(routes.length);
    expect(diffs).toEqual([]);
    expect(notBotNotFound).toEqual([]);

    // Aucune route ne répond par une erreur de forme avant le contrôle de l'agent IA (le test ne passerait pas à vide) :
    // « Agent IA introuvable. » (bot.not_found) partout, sauf le branchement et l'activation, dont le refus nomme aussi
    // le numéro (assign.not_found), identique pour un agent IA de beta et un agent IA inexistant.
    const answers = await Promise.all(routes.map(async ([label, call]) => [label, shape(await call(MISSING))] as const));
    expect(answers.filter(([, a]) => a.reason === 'assign.not_found').map(([l]) => l)).toEqual([
      'PUT /bots/:id/number (agent IA de beta)', 'POST /bots/:id/activate (agent IA de beta)',
    ]);
    expect(answers.filter(([, a]) => a.reason !== 'assign.not_found' && a.reason !== 'bot.not_found').map(([l, a]) => [l, a.message])).toEqual([]);

    // Rien n'a bougé chez beta, ni chez acme.
    expect(await snapshot()).toEqual(before);
  });
});
