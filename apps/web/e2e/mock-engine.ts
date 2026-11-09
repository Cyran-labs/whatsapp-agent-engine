import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  ASSIGN_NUMBER_REMOVED_MESSAGE,
  decideTransition as decideContractTransition,
  HOLDER_CHANGED_MESSAGE,
  HOLDER_CHANGED_PATH,
  isServingStatus,
  toBotStatus,
  TRANSITION_MESSAGES,
  type BotNumberSummary,
  type TransitionRefusal,
  type WhatsAppAccountAlertView,
  type WhatsAppAccountCreated,
  type WhatsAppAccountReplaced,
  type WhatsAppAccountVerified,
  type WhatsAppAccountView,
  type WhatsAppInventorySummary,
  type WhatsAppNumberView,
  type WhatsAppVerificationCheck,
  type WhatsAppWebhookView,
} from '@wabagent/contracts';
import {
  initialState,
  type Account,
  type Bot,
  type Grant,
  type Invitation,
  type State,
  type WhatsAppAccount,
  type WhatsAppNumber,
} from './mock-state';

const PORT = 4999;
const PREFIX = '/api/admin/v1';
const SESSION_MESSAGE = 'Session expirée.';
const INVALID_INVITE = 'Invitation invalide ou expirée.';
const INVALID_RESET = 'Lien de réinitialisation invalide ou expiré.';
const PASSWORD_TOO_SHORT = 'Le mot de passe doit faire au moins 10 caractères.';

let state: State = initialState();

type Body = Record<string, unknown>;
type Ctx = { req: IncomingMessage; res: ServerResponse; method: string; query: URLSearchParams; body: Body };

function send(res: ServerResponse, status: number, body?: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function fail(res: ServerResponse, status: number, code: string, message: string, details?: { path: string; message: string }[]): void {
  send(res, status, { error: { code, message, request_id: 'r', ...(details ? { details } : {}) } });
}

function readBody(req: IncomingMessage): Promise<Body> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? (JSON.parse(data) as Body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function grantsOf(v: unknown): Grant[] {
  if (!Array.isArray(v)) return [];
  return v.map((g) => {
    const o = g as Body;
    return { entity_id: typeof o.entity_id === 'number' ? o.entity_id : null, role: str(o.role), read_only: o.read_only === true };
  });
}

// ---------- session et organisation ----------

/** Jeton d'accès au format JWT comme le moteur (sujet = identifiant utilisateur), signature factice. */
function accessToken(account: Account): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'HS256' })}.${part({ sub: String(account.id), role: 'user' })}.mock`;
}

function tokens(account: Account) {
  return { access_token: accessToken(account), refresh_token: `refresh-${account.id}` };
}

/** Utilisateur public renvoyé par login, refresh et accept-invite (sans `organizations`, comme le moteur). */
function publicUser(account: Account) {
  const { organizations: _organizations, ...user } = meOf(account);
  return user;
}

/** Zod du moteur : mot de passe trop court en 400 standard sur le champ `password`. */
function failShortPassword(res: ServerResponse): void {
  fail(res, 400, 'VALIDATION_ERROR', 'Données invalides.', [{ path: 'password', message: PASSWORD_TOO_SHORT }]);
}

function meOf(account: Account) {
  const organizations = state.orgs.flatMap((org) => {
    const own = state.memberships.filter((m) => m.user_id === account.id && m.client_id === org.client_id && m.status === 'active');
    if (own.length === 0) return [];
    const orgGrant = own.find((m) => m.entity_id === null);
    const role = orgGrant?.role ?? (own.some((m) => m.role === 'manager') ? 'manager' : 'advisor');
    return [{ client_id: org.client_id, name: org.name, role, read_only: orgGrant?.read_only === true }];
  });
  return { id: account.id, email: account.email, role: 'client_admin', client_id: organizations[0]?.client_id ?? null, status: 'active', organizations };
}

function authenticate(req: IncomingMessage): Account | null {
  const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
  return state.accounts.find((a) => accessToken(a) === token) ?? null;
}

/** Résout l'organisation de la requête (en-tête `X-Organization-Id`) ; répond 400 ou 403 sinon. */
function resolveOrg(ctx: Ctx, account: Account): { client_id: string; role: string; read_only: boolean } | null {
  const orgs = meOf(account).organizations;
  const header = ctx.req.headers['x-organization-id'];
  const wanted = typeof header === 'string' ? header : undefined;
  if (!wanted) {
    if (orgs.length === 1) return orgs[0];
    if (orgs.length === 0) fail(ctx.res, 403, 'FORBIDDEN', 'Accès refusé.');
    else fail(ctx.res, 400, 'VALIDATION_ERROR', 'Données invalides.', [{ path: 'X-Organization-Id', message: 'Organisation à préciser.' }]);
    return null;
  }
  const org = orgs.find((o) => o.client_id === wanted);
  if (!org) {
    fail(ctx.res, 403, 'FORBIDDEN', 'Accès refusé.');
    return null;
  }
  return org;
}

// ---------- vues ----------

const entityView = (clientId: string) =>
  state.entities
    .filter((e) => e.client_id === clientId)
    .map((e) => ({
      id: e.id,
      name: e.name,
      status: e.status,
      bots: state.bots.filter((b) => b.entity_id === e.id).length,
      members: new Set(state.memberships.filter((m) => m.entity_id === e.id).map((m) => m.user_id)).size,
    }));

function memberView(clientId: string) {
  const ids = [...new Set(state.memberships.filter((m) => m.client_id === clientId).map((m) => m.user_id))];
  return ids.flatMap((id) => {
    const account = state.accounts.find((a) => a.id === id);
    if (!account) return [];
    const memberships = state.memberships
      .filter((m) => m.user_id === id && m.client_id === clientId)
      .map((m) => ({ entity_id: m.entity_id, role: m.role, read_only: m.read_only, status: m.status }));
    return [{ user_id: id, email: account.email, status: 'active', memberships }];
  });
}

function emailHint(email: string): string {
  const at = email.lastIndexOf('@');
  return `${email[0]}•••••${email.slice(at)}`;
}

function grantsSummary(inv: Invitation) {
  const org = inv.grants.find((g) => g.entity_id === null);
  if (org) return { scope: 'organization', role: org.role, read_only: org.read_only };
  return {
    scope: 'entities',
    entities: inv.grants.map((g) => ({ entity_name: state.entities.find((e) => e.id === g.entity_id)?.name ?? '', role: g.role })),
  };
}

const pendingInvitation = (token: string): Invitation | undefined =>
  state.invitations.find((i) => i.token === token && i.accepted_at === null);

function applyInvitation(inv: Invitation, userId: number): void {
  inv.accepted_at = '2026-11-08T00:00:00.000Z';
  state.memberships = state.memberships.filter((m) => !(m.user_id === userId && m.client_id === inv.client_id));
  for (const g of inv.grants) state.memberships.push({ user_id: userId, client_id: inv.client_id, status: 'active', ...g });
}

// ---------- routes d'authentification ----------

async function authRoutes(ctx: Ctx, route: string): Promise<boolean> {
  const { res, body } = ctx;
  if (route === '/auth/login') {
    const account = state.accounts.find((a) => a.email === str(body.email));
    if (account && account.password === str(body.password)) send(res, 200, { ...tokens(account), user: publicUser(account) });
    else fail(res, 401, 'UNAUTHORIZED', 'Identifiants invalides.');
    return true;
  }
  if (route === '/auth/refresh') {
    const m = /^refresh-(\d+)$/.exec(str(body.refresh_token));
    const account = m ? state.accounts.find((a) => a.id === Number(m[1])) : undefined;
    if (account) send(res, 200, { ...tokens(account), user: publicUser(account) });
    else fail(res, 401, 'UNAUTHORIZED', SESSION_MESSAGE);
    return true;
  }
  if (route === '/auth/logout') {
    send(res, 204);
    return true;
  }
  if (route === '/auth/accept-invite') {
    if (str(body.password).length < 10) {
      failShortPassword(res);
      return true;
    }
    const inv = pendingInvitation(str(body.token));
    if (!inv || state.accounts.some((a) => a.email === inv.email)) {
      fail(res, 401, 'UNAUTHORIZED', INVALID_INVITE);
      return true;
    }
    const account: Account = { id: state.nextIds.account++, email: inv.email, password: str(body.password) };
    state.accounts.push(account);
    for (const pending of state.invitations.filter((i) => i.email === inv.email && i.accepted_at === null)) applyInvitation(pending, account.id);
    send(res, 200, { ...tokens(account), user: publicUser(account) });
    return true;
  }
  if (route === '/auth/invitations/info') {
    const inv = pendingInvitation(str(body.token));
    if (!inv) {
      fail(res, 401, 'UNAUTHORIZED', INVALID_INVITE);
      return true;
    }
    send(res, 200, {
      organization_name: state.orgs.find((o) => o.client_id === inv.client_id)?.name ?? '',
      requires_account_creation: !state.accounts.some((a) => a.email === inv.email),
      email_hint: emailHint(inv.email),
      grants_summary: grantsSummary(inv),
    });
    return true;
  }
  if (route === '/auth/forgot-password') {
    // comme le moteur : lien émis seulement pour un compte connu, `invite` repris seulement s'il vise cette adresse
    const email = str(body.email).trim().toLowerCase();
    const account = state.accounts.find((a) => a.email === email);
    if (account) {
      const token = `reset-${state.nextIds.reset++}`;
      state.resetTokens.set(token, account.id);
      const invite = typeof body.invite === 'string' ? pendingInvitation(body.invite) : undefined;
      const withInvite = invite !== undefined && invite.email === email;
      state.lastResetLink = `/reset-password?token=${token}${withInvite ? `&invite=${encodeURIComponent(str(body.invite))}` : ''}`;
    }
    send(res, 204);
    return true;
  }
  if (route === '/auth/reset-password') {
    if (str(body.password).length < 10) {
      failShortPassword(res);
      return true;
    }
    const accountId = state.resetTokens.get(str(body.token));
    const account = state.accounts.find((a) => a.id === accountId);
    if (!account) {
      fail(res, 401, 'UNAUTHORIZED', INVALID_RESET);
      return true;
    }
    account.password = str(body.password);
    state.resetTokens.delete(str(body.token));
    send(res, 204);
    return true;
  }
  return false;
}

async function sessionAuthRoutes(ctx: Ctx, route: string, account: Account): Promise<boolean> {
  const { res, body } = ctx;
  if (route === '/auth/me') {
    send(res, 200, meOf(account));
    return true;
  }
  if (route === '/auth/change-password') {
    if (account.password !== str(body.current_password)) {
      const message = 'Mot de passe actuel incorrect.';
      fail(res, 400, 'VALIDATION_ERROR', message, [{ path: 'current_password', message }]);
    }
    else {
      account.password = str(body.new_password);
      send(res, 200, { ...tokens(account), user: publicUser(account) });
    }
    return true;
  }
  if (route === '/auth/invitations/accept') {
    const inv = pendingInvitation(str(body.token));
    if (!inv || inv.email !== account.email) {
      fail(res, 401, 'UNAUTHORIZED', INVALID_INVITE);
      return true;
    }
    applyInvitation(inv, account.id);
    send(res, 200, { organizations: meOf(account).organizations });
    return true;
  }
  return false;
}

// ---------- routes d'administration (organisation courante) ----------

// ---------- WhatsApp : comptes, numéros, machine d'états des agents IA ----------

// La machine d'états et ses messages viennent des contrats (`decideTransition`, `TRANSITION_MESSAGES`), les mêmes
// que le moteur réel ; les autres règles (services) sont recopiées. mock-whatsapp.spec.ts fige les messages en littéraux.

const BOT_NOT_FOUND = 'Agent IA introuvable.';
const BOT_OR_NUMBER_NOT_FOUND = 'Agent IA ou numéro WhatsApp introuvable.';
const ACCOUNT_NOT_FOUND = 'Compte WhatsApp introuvable.';
const NUMBER_NOT_FOUND = 'Numéro WhatsApp introuvable.';
const ALREADY_CONNECTED = 'Ce compte WhatsApp est déjà raccordé.';
const CANNOT_CONNECT = 'Ce compte ne peut pas être raccordé. Contactez le support.';
const OTHER_PROVIDER_ACCOUNT = 'Pour une autre WABA ou un autre compte CM.com, raccordez un nouveau compte.';
const ACCOUNT_DISCONNECTED = 'Ce compte WhatsApp est déconnecté : raccordez un nouveau compte.';
const NUMBERS_IN_USE = "Mettez d'abord en pause ou en brouillon les agents IA qui utilisent ce compte.";
const INVALID_ALLOWLIST_ENTRY = 'Numéro au format international (ex. +33612345678) ou identifiant WhatsApp attendu.';
const ALLOWLIST_MAX = 20;
const ALLOWLIST_ENTRY_MAX = 64;
/** WABA ID qui échoue toujours à la vérification chez le faux fournisseur. */
const REFUSED_WABA_ID = '000000';
/** Jeton d'accès que le faux fournisseur refuse (mauvais identifiants, quelle que soit la WABA). */
const REFUSED_ACCESS_TOKEN = 'EAAG-jeton-refuse-0000';
const MOCK_PUBLIC_BASE_URL = 'https://dev.wabagent.com';
const TOKEN_EXPIRING_MS = 7 * 24 * 3600 * 1000;

type ApiDetail = { path: string; message: string };
type Parsed<T> = { ok: true; value: T } | { ok: false; details: ApiDetail[] };

const isServing = isServingStatus;

function tokenExpiring(expiry: string | null): boolean {
  if (expiry === null || expiry === 'never') return false;
  const at = Date.parse(expiry);
  return Number.isFinite(at) && at - Date.now() < TOKEN_EXPIRING_MS;
}

function numberViewOf(n: WhatsAppNumber): WhatsAppNumberView {
  const bot = n.bot_id === null ? undefined : state.bots.find((b) => b.client_id === n.client_id && b.bot_id === n.bot_id);
  return {
    id: n.id,
    phone_e164: n.phone_e164,
    display_name: n.display_name,
    meta_status: n.meta_status,
    quality: n.quality,
    is_test: n.is_test,
    provider_state: n.provider_state,
    removed_at: n.removed_at,
    delivery_failures: n.delivery_failures,
    last_delivery_error_code: n.last_delivery_error_code,
    bot: bot ? { bot_id: bot.bot_id, name: bot.name, status: bot.status } : null,
  };
}

/** Vue d'un compte : un compte déconnecté n'a plus de numéros, comme le moteur. Jamais de webhook (revue 2b-3 M-2). */
function accountViewOf(a: WhatsAppAccount): WhatsAppAccountView {
  const disconnected = a.state === 'disconnected';
  const numbers = disconnected ? [] : state.whatsappNumbers.filter((n) => n.client_id === a.client_id && n.account_id === a.id);
  const present = numbers.filter((n) => n.provider_state === 'present');
  const alerts: WhatsAppAccountAlertView[] = [...a.alerts];
  if (a.token_expiry !== null && tokenExpiring(a.token_expiry)) alerts.push({ kind: 'token_expiring', at: a.token_expiry });
  for (const n of present) if (n.quality === 'RED') alerts.push({ kind: 'quality_degraded', number_id: n.id });
  return {
    id: a.id,
    name: a.name,
    mode: a.mode,
    provider_account_id: a.provider_account_id,
    waba_id: a.waba_id,
    meta_app_id: a.meta_app_id,
    state: a.state,
    error_reason: a.error_reason,
    error_detail: null,
    last_verified_at: a.last_verified_at,
    token_expiry: a.token_expiry,
    secret_checked_at: a.secret_checked_at,
    is_test: present.length > 0 && present.every((n) => n.is_test),
    alerts,
    numbers: numbers.map(numberViewOf),
  };
}

/** Webhook d'un compte (`GET /whatsapp-accounts/:id/webhook`) : vide pour un compte déconnecté, comme le moteur. */
function webhookOf(a: WhatsAppAccount): WhatsAppWebhookView {
  return a.state === 'disconnected' ? { path: '', url: null, verify_token: null } : { ...a.webhook };
}

const numberOfBot = (b: Bot): WhatsAppNumber | undefined =>
  state.whatsappNumbers.find((n) => n.client_id === b.client_id && n.bot_id === b.bot_id);

/** Numéro branché sur l'agent IA (présent ou retiré) avec l'état de son compte, null sans numéro. */
function numberSummaryOf(b: Bot): BotNumberSummary | null {
  const n = numberOfBot(b);
  const account = n ? state.whatsappAccounts.find((a) => a.client_id === b.client_id && a.id === n.account_id) : undefined;
  if (!n || !account) return null;
  return {
    id: n.id,
    phone_e164: n.phone_e164,
    display_name: n.display_name,
    is_test: n.is_test,
    provider_state: n.provider_state,
    quality: n.quality,
    account: { id: account.id, name: account.name, mode: account.mode, state: account.state, error_reason: account.error_reason },
  };
}

/** Vue de l'agent IA du moteur : l'enregistrement (`client_id` compris) plus numéro, liste d'accès limité et non servis. */
function botView(b: Bot) {
  return { ...b, whatsapp_number: numberSummaryOf(b) };
}

interface NumberFacts { present: boolean; is_test: boolean; account_state: WhatsAppAccountView['state'] }

function factsOf(n: WhatsAppNumber): NumberFacts {
  const account = state.whatsappAccounts.find((a) => a.client_id === n.client_id && a.id === n.account_id);
  return { present: n.provider_state === 'present', is_test: n.is_test, account_state: account?.state ?? 'disconnected' };
}

/** Décision des contrats, rendue sous la forme `refus ou null` que les routes du faux moteur utilisent. */
function decideTransition(to: string, from: string, number: NumberFacts | null, allowlistCount: number): TransitionRefusal | null {
  const decision = decideContractTransition(toBotStatus(to), { from: toBotStatus(from), number, allowlistCount });
  return decision.ok ? null : decision.reason;
}

/** Branchement : un numéro retiré ne se branche jamais ; un agent IA en service doit rester valide sur ce numéro. */
function decideAssign(bot: Bot, number: WhatsAppNumber, checkServingStatus: boolean): TransitionRefusal | null {
  if (number.provider_state !== 'present') return 'number_removed';
  if (number.bot_id === bot.bot_id) return null;
  if (checkServingStatus && isServing(bot.status)) return decideTransition(bot.status, bot.status, factsOf(number), bot.allowlist.length);
  return null;
}

function writeStatus(bot: Bot, status: string): void {
  bot.status = status;
  bot.status_reason = null;
}

/** Applique un branchement accepté : l'ancien numéro de l'agent IA est libéré, l'agent IA qui tenait le numéro repasse en brouillon. */
function applyAssign(bot: Bot, number: WhatsAppNumber): void {
  if (number.bot_id === bot.bot_id) return;
  const current = numberOfBot(bot);
  if (current) current.bot_id = null;
  const previous = number.bot_id === null ? undefined : state.bots.find((b) => b.client_id === number.client_id && b.bot_id === number.bot_id);
  if (previous && isServing(previous.status)) writeStatus(previous, 'draft');
  number.bot_id = bot.bot_id;
  bot.status_reason = null;
}

/** Entrée de liste d'accès limité : BSUID conservé, numéro normalisé en E.164 (`src/core/phone.ts`), sinon null. */
function normalizeEntry(input: string): string | null {
  const trimmed = input.trim();
  if (/^[A-Z]{2}\.[A-Za-z0-9_]+$/.test(trimmed)) return trimmed;
  let value = trimmed.replace(/[\s.\-()]/g, '');
  if (value.startsWith('+')) value = value.slice(1);
  else if (value.startsWith('00')) value = value.slice(2);
  return /^[1-9][0-9]{7,14}$/.test(value) ? `+${value}` : null;
}

/** Contrat `SetAllowlistInput` puis normalisation du service : une erreur par indice, 20 entrées au plus. */
function parseEntries(raw: unknown, path: string): Parsed<string[]> {
  if (raw === undefined && path === 'allowlist') return { ok: true, value: [] };
  if (!Array.isArray(raw) || raw.some((e) => typeof e !== 'string')) return { ok: false, details: [{ path, message: 'Liste de chaînes attendue.' }] };
  const entries = raw as string[];
  const contract: ApiDetail[] = [];
  entries.forEach((e, i) => {
    if (e.length > ALLOWLIST_ENTRY_MAX) contract.push({ path: `${path}.${i}`, message: `${ALLOWLIST_ENTRY_MAX} caractères au plus.` });
  });
  if (entries.length > ALLOWLIST_MAX) contract.push({ path, message: `${ALLOWLIST_MAX} entrées au plus.` });
  if (contract.length > 0) return { ok: false, details: contract };
  const invalid: ApiDetail[] = [];
  const normalized: string[] = [];
  entries.forEach((e, i) => {
    const value = normalizeEntry(e);
    if (value === null) invalid.push({ path: `${path}.${i}`, message: INVALID_ALLOWLIST_ENTRY });
    else normalized.push(value);
  });
  if (invalid.length > 0) return { ok: false, details: invalid };
  const unique = [...new Set(normalized)];
  if (unique.length > ALLOWLIST_MAX) return { ok: false, details: [{ path, message: `${ALLOWLIST_MAX} entrées au plus.` }] };
  return { ok: true, value: unique };
}

function parseNumberId(body: Body): Parsed<number> {
  const id = body.number_id;
  return typeof id === 'number' && Number.isInteger(id) && id > 0
    ? { ok: true, value: id }
    : { ok: false, details: [{ path: 'number_id', message: 'Entier positif attendu.' }] };
}

/** Contrat `AssignNumberInput` / `ActivateBotInput` : `expected_bot_id` obligatoire, identifiant (1 à 64 caractères) ou null. */
function parseExpectedHolder(body: Body): Parsed<string | null> {
  const holder = body.expected_bot_id;
  if (holder === null) return { ok: true, value: null };
  return typeof holder === 'string' && holder.length >= 1 && holder.length <= 64
    ? { ok: true, value: holder }
    : { ok: false, details: [{ path: 'expected_bot_id', message: 'Identifiant de l\'agent IA ou null attendu.' }] };
}

/** Détenteur attendu différent du détenteur réel (hors agent IA cible déjà détenteur) : 409, rien n'est écrit (revue 2b-3 M-1). */
function holderChanged(bot: Bot, number: WhatsAppNumber, expected: string | null): boolean {
  return number.bot_id !== bot.bot_id && number.bot_id !== expected;
}

const refuseHolderChanged = (res: ServerResponse): true => {
  fail(res, 409, 'CONFLICT', HOLDER_CHANGED_MESSAGE, [{ path: HOLDER_CHANGED_PATH, message: HOLDER_CHANGED_MESSAGE }]);
  return true;
};

function badRequest(res: ServerResponse, details: ApiDetail[]): true {
  fail(res, 400, 'VALIDATION_ERROR', 'Données invalides.', details);
  return true;
}

const refuse = (res: ServerResponse, reason: TransitionRefusal): true => {
  fail(res, 409, 'CONFLICT', TRANSITION_MESSAGES[reason]);
  return true;
};

/** Refus du branchement (`PUT /number`, `POST /activate`) : un numéro retiré a son propre texte (revue finale 2b-3 I-3). */
const refuseAssign = (res: ServerResponse, reason: TransitionRefusal): true =>
  reason === 'number_removed' ? (fail(res, 409, 'CONFLICT', ASSIGN_NUMBER_REMOVED_MESSAGE), true) : refuse(res, reason);

/**
 * Actions de l'agent IA sur son numéro, son statut et sa liste (`src/api/admin/routes/bots.ts`, `bot-service.ts`).
 * Chaque lecture de numéro est bornée à l'organisation de l'agent IA : le numéro d'une autre organisation répond
 * comme un numéro absent. Un refus n'écrit rien.
 */
function botActionRoutes(ctx: Ctx, bot: Bot, sub: string): boolean {
  const { res, method, body } = ctx;
  const numberOf = (id: number): WhatsAppNumber | undefined =>
    state.whatsappNumbers.find((n) => n.client_id === bot.client_id && n.id === id);

  if (sub === '/number' && method === 'PUT') {
    const parsed = parseNumberId(body);
    const holder = parseExpectedHolder(body);
    if (!parsed.ok || !holder.ok) return badRequest(res, [...(parsed.ok ? [] : parsed.details), ...(holder.ok ? [] : holder.details)]);
    const number = numberOf(parsed.value);
    if (!number) { fail(res, 404, 'NOT_FOUND', BOT_OR_NUMBER_NOT_FOUND); return true; }
    if (number.provider_state === 'present' && holderChanged(bot, number, holder.value)) return refuseHolderChanged(res);
    const refusal = decideAssign(bot, number, true);
    if (refusal) return refuseAssign(res, refusal);
    applyAssign(bot, number);
    send(res, 200, botView(bot));
    return true;
  }
  // `UnassignNumberInput` : `expected_number_id` obligatoire ; différent du numéro branché (ou agent IA sans numéro) : 409.
  if (sub === '/number/unassign' && method === 'POST') {
    const expected = body.expected_number_id;
    if (typeof expected !== 'number' || !Number.isInteger(expected) || expected <= 0) {
      return badRequest(res, [{ path: 'expected_number_id', message: 'Entier positif attendu.' }]);
    }
    const current = numberOfBot(bot);
    if (!current || current.id !== expected) return refuseHolderChanged(res);
    current.bot_id = null;
    if (isServing(bot.status)) writeStatus(bot, 'draft');
    send(res, 200, botView(bot));
    return true;
  }
  if (sub === '/status' && method === 'PUT') {
    const status = body.status;
    if (status !== 'draft' && status !== 'limited' && status !== 'active' && status !== 'paused') {
      return badRequest(res, [{ path: 'status', message: "Statut attendu : 'draft', 'limited', 'active' ou 'paused'." }]);
    }
    const current = numberOfBot(bot);
    const refusal = decideTransition(status, bot.status, current ? factsOf(current) : null, bot.allowlist.length);
    if (refusal) return refuse(res, refusal);
    writeStatus(bot, status);
    send(res, 200, botView(bot));
    return true;
  }
  if (sub === '/allowlist' && method === 'PUT') {
    const parsed = parseEntries(body.entries, 'entries');
    if (!parsed.ok) return badRequest(res, parsed.details);
    if (bot.status === 'limited' && parsed.value.length === 0) return refuse(res, 'empty_allowlist');
    bot.allowlist = parsed.value;
    send(res, 200, botView(bot));
    return true;
  }
  if (sub === '/activate' && method === 'POST') {
    const id = parseNumberId(body);
    const holder = parseExpectedHolder(body);
    const status = body.status;
    const allowlist = parseEntries(body.allowlist, 'allowlist');
    const details: ApiDetail[] = [
      ...(id.ok ? [] : id.details),
      ...(holder.ok ? [] : holder.details),
      ...(status === 'limited' || status === 'active' ? [] : [{ path: 'status', message: "Statut attendu : 'limited' ou 'active'." }]),
      ...(allowlist.ok ? [] : allowlist.details),
    ];
    if (!id.ok || !holder.ok || !allowlist.ok || (status !== 'limited' && status !== 'active')) return badRequest(res, details);
    const number = numberOf(id.value);
    if (!number) { fail(res, 404, 'NOT_FOUND', BOT_OR_NUMBER_NOT_FOUND); return true; }
    if (number.provider_state === 'present' && holderChanged(bot, number, holder.value)) return refuseHolderChanged(res);
    const assignRefusal = decideAssign(bot, number, false);
    if (assignRefusal) return refuseAssign(res, assignRefusal);
    // En accès limité la liste fournie remplace la liste ; en accès à tous, une liste vide laisse la liste existante.
    const written = status === 'limited' || allowlist.value.length > 0 ? allowlist.value : null;
    const refusal = decideTransition(status, bot.status, factsOf(number), written ? written.length : bot.allowlist.length);
    if (refusal) return refuse(res, refusal);
    applyAssign(bot, number);
    if (written) bot.allowlist = written;
    writeStatus(bot, status);
    send(res, 200, botView(bot));
    return true;
  }
  return false;
}

// ---------- WhatsApp : comptes (`src/api/admin/routes/whatsapp-accounts.ts`), administrateur seulement ----------

const idOrNull = (raw: string | undefined): number | null => (raw !== undefined && /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : null);

/** Contrôle des champs comme les schémas Zod des contrats (`CreateWhatsAppAccountInput`, `ReplaceWhatsAppCredentialsInput`). */
function parseCredentials(body: Body, withName: boolean): Parsed<{ mode: 'meta_manual' | 'cm_com'; name: string; providerId: string }> {
  const details: ApiDetail[] = [];
  const text = (key: string): string => str(body[key]).trim();
  const range = (key: string, min: number, max: number): void => {
    const n = text(key).length;
    if (n < min) details.push({ path: key, message: `String must contain at least ${min} character(s)` });
    else if (n > max) details.push({ path: key, message: `String must contain at most ${max} character(s)` });
  };
  const mode = body.mode;
  if (mode !== 'meta_manual' && mode !== 'cm_com') {
    return { ok: false, details: [{ path: 'mode', message: "Invalid discriminator value. Expected 'meta_manual' | 'cm_com'" }] };
  }
  if (withName) range('name', 1, 80);
  if (mode === 'meta_manual') {
    if (!/^\d{5,25}$/.test(text('waba_id'))) details.push({ path: 'waba_id', message: 'WABA ID : 5 à 25 chiffres.' });
    range('access_token', 20, 1000);
    range('app_secret', 16, 128);
  } else {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text('account_id'))) details.push({ path: 'account_id', message: 'Invalid uuid' });
    range('product_token', 10, 200);
  }
  if (details.length > 0) return { ok: false, details };
  return { ok: true, value: { mode, name: text('name'), providerId: mode === 'meta_manual' ? text('waba_id') : text('account_id').toLowerCase() } };
}

/** Contrôles du faux fournisseur : tout réussit, sauf le WABA ID `000000` (accès refusé) et le jeton `REFUSED_ACCESS_TOKEN`. */
function verificationChecks(mode: 'meta_manual' | 'cm_com', providerId: string, accessToken = ''): WhatsAppVerificationCheck[] {
  if (mode === 'cm_com') {
    return [{ key: 'cm_account', status: 'ok' }, { key: 'cm_channels', status: 'ok' }];
  }
  const denied = providerId === REFUSED_WABA_ID;
  const badToken = accessToken === REFUSED_ACCESS_TOKEN;
  return [
    { key: 'token', status: badToken ? 'failed' : 'ok', ...(badToken ? { detail: 'Le jeton est refusé par Meta.' } : {}) },
    { key: 'waba_access', status: denied ? 'failed' : 'ok', ...(denied ? { detail: 'Ce WABA ID est introuvable ou inaccessible avec ce jeton.' } : {}) },
    { key: 'app_secret', status: 'ok' },
    { key: 'subscription', status: denied ? 'pending' : 'created' },
    { key: 'token_expiry', status: 'ok' },
    { key: 'numbers', status: denied ? 'pending' : 'ok' },
    { key: 'app', status: 'ok' },
  ];
}

/** Échec de vérification : 422, un détail par contrôle en échec (chemin = clé du contrôle), comme le moteur. */
function failVerification(res: ServerResponse, checks: WhatsAppVerificationCheck[]): void {
  const details = checks.filter((c) => c.status === 'failed').map((c) => ({ path: c.key, message: c.detail ?? 'Vérification impossible.' }));
  fail(res, 422, 'WA_VALIDATION_FAILED', 'Vérification du compte impossible.', details);
}

const NO_INVENTORY_CHANGE: WhatsAppInventorySummary = { added: 0, removed: 0, refused: 0, skipped_sandbox: 0, skipped_invalid: 0 };

function randomKey(): string {
  return Buffer.from(Array.from({ length: 32 }, () => Math.floor(Math.random() * 256))).toString('base64url');
}

function whatsappAccountRoutes(ctx: Ctx, route: string, clientId: string, isAdmin: boolean): boolean {
  const m = /^\/whatsapp-accounts(?:\/([^/]+))?(?:\/([a-z-]+)(?:\/([^/]+))?)?$/.exec(route);
  if (!m) return false;
  const { res, method, body } = ctx;
  if (!isAdmin) { fail(res, 403, 'FORBIDDEN', 'Accès refusé.'); return true; }
  const [, rawId, sub, rawNumberId] = m;
  const notFound = (message: string): true => { fail(res, 404, 'NOT_FOUND', message); return true; };
  const conflict = (message: string, details?: ApiDetail[]): true => { fail(res, 409, 'CONFLICT', message, details); return true; };

  if (rawId === undefined) {
    if (method === 'GET') {
      send(res, 200, state.whatsappAccounts.filter((a) => a.client_id === clientId).map(accountViewOf));
      return true;
    }
    if (method !== 'POST') return false;
    const parsed = parseCredentials(body, true);
    if (!parsed.ok) return badRequest(res, parsed.details);
    const { mode, name, providerId } = parsed.value;
    // Même organisation : « déjà raccordé » tout de suite. Autre organisation : message neutre, mais seulement après la
    // vérification du fournisseur (revue 2b-2 I-1) : un jeton quelconque ne doit pas révéler qu'une WABA est tenue.
    const heldBy = (): string | undefined =>
      state.whatsappAccounts.find((a) => a.mode === mode && a.provider_account_id.toLowerCase() === providerId.toLowerCase() && a.state !== 'disconnected')?.client_id;
    if (heldBy() === clientId) return conflict(ALREADY_CONNECTED);
    const checks = verificationChecks(mode, providerId, str(body.access_token).trim());
    if (checks.some((c) => c.status === 'failed')) { failVerification(res, checks); return true; }
    if (heldBy() !== undefined) return conflict(CANNOT_CONNECT);
    const id = state.nextIds.whatsappAccount++;
    const now = new Date().toISOString();
    const key = randomKey();
    const path = mode === 'meta_manual' ? `/webhook/meta/${key}` : `/webhook/cm-com/${key}`;
    const account: WhatsAppAccount = {
      id, client_id: clientId, name, mode, provider_account_id: providerId, waba_id: mode === 'meta_manual' ? providerId : null,
      meta_app_id: mode === 'meta_manual' ? `app-${providerId}` : null,
      state: 'connected', error_reason: null, last_verified_at: now, token_expiry: 'never', secret_checked_at: null, alerts: [],
      webhook: { path, url: `${MOCK_PUBLIC_BASE_URL}${path}`, verify_token: mode === 'meta_manual' ? randomKey().slice(0, 24) : null },
    };
    state.whatsappAccounts.push(account);
    // Inventaire du faux fournisseur : un numéro de production par compte raccordé.
    const numberId = state.nextIds.whatsappNumber++;
    state.whatsappNumbers.push({
      id: numberId, client_id: clientId, account_id: id, phone_e164: `+3319${String(numberId).padStart(7, '0')}`, display_name: name,
      meta_status: 'CONNECTED', quality: 'GREEN', is_test: false, provider_state: 'present', removed_at: null,
      delivery_failures: 0, last_delivery_error_code: null, bot_id: null,
    });
    const created: WhatsAppAccountCreated = { ...accountViewOf(account), webhook: webhookOf(account), checks, inventory: { ...NO_INVENTORY_CHANGE, added: 1 } };
    send(res, 201, created);
    return true;
  }

  const id = idOrNull(rawId);
  const account = id === null ? undefined : state.whatsappAccounts.find((a) => a.client_id === clientId && a.id === id);
  if (!account) return notFound(ACCOUNT_NOT_FOUND);

  if (sub === undefined && method === 'GET') { send(res, 200, accountViewOf(account)); return true; }
  if (sub === 'webhook' && method === 'GET') { send(res, 200, webhookOf(account)); return true; }
  if (sub === undefined && method === 'PATCH') {
    const name = str(body.name).trim();
    if (name.length < 1 || name.length > 80) {
      return badRequest(res, [{ path: 'name', message: name.length < 1 ? 'String must contain at least 1 character(s)' : 'String must contain at most 80 character(s)' }]);
    }
    account.name = name;
    send(res, 200, accountViewOf(account));
    return true;
  }
  if (sub === 'credentials' && method === 'PUT') {
    const parsed = parseCredentials(body, false);
    if (!parsed.ok) return badRequest(res, parsed.details);
    if (account.state === 'disconnected') return conflict(ACCOUNT_DISCONNECTED);
    if (parsed.value.mode !== account.mode || parsed.value.providerId.toLowerCase() !== account.provider_account_id.toLowerCase()) {
      return conflict(OTHER_PROVIDER_ACCOUNT);
    }
    const checks = verificationChecks(account.mode, account.provider_account_id);
    if (checks.some((c) => c.status === 'failed')) { failVerification(res, checks); return true; }
    // Identifiants remplacés : l'adresse du webhook et le jeton de vérification sont conservés.
    account.state = 'connected';
    account.error_reason = null;
    account.last_verified_at = new Date().toISOString();
    const replaced: WhatsAppAccountReplaced = { ...accountViewOf(account), checks, inventory: { ...NO_INVENTORY_CHANGE } };
    send(res, 200, replaced);
    return true;
  }
  if (sub === 'verify' && method === 'POST') {
    if (account.state === 'disconnected') return conflict(ACCOUNT_DISCONNECTED);
    account.state = 'connected';
    account.error_reason = null;
    account.last_verified_at = new Date().toISOString();
    // Le faux fournisseur n'échoue jamais ici : l'issue est toujours `verified`.
    const verified: WhatsAppAccountVerified = { ...accountViewOf(account), checks: verificationChecks(account.mode, account.provider_account_id), outcome: 'verified' };
    send(res, 200, verified);
    return true;
  }
  if (sub === 'refresh-numbers' && method === 'POST') {
    if (account.state === 'disconnected') return conflict(ACCOUNT_DISCONNECTED);
    send(res, 200, { ...accountViewOf(account), inventory: { ...NO_INVENTORY_CHANGE } });
    return true;
  }
  if (sub === 'disconnect' && method === 'POST') {
    if (account.state === 'disconnected') { send(res, 204); return true; }
    const inUse = state.whatsappNumbers
      .filter((n) => n.client_id === clientId && n.account_id === account.id && n.provider_state === 'present' && n.bot_id !== null)
      .flatMap((n) => state.bots.filter((b) => b.client_id === clientId && b.bot_id === n.bot_id && isServing(b.status)))
      .sort((a, b) => a.bot_id.localeCompare(b.bot_id));
    if (inUse.length > 0) return conflict(NUMBERS_IN_USE, inUse.map((b) => ({ path: `bots.${b.bot_id}`, message: b.name })));
    // Les numéros du compte disparaissent (les agents IA qui les tenaient, hors service, les perdent), le webhook aussi.
    state.whatsappNumbers = state.whatsappNumbers.filter((n) => !(n.client_id === clientId && n.account_id === account.id));
    account.state = 'disconnected';
    account.error_reason = null;
    send(res, 204);
    return true;
  }
  if (sub === 'numbers' && method === 'PATCH') {
    const numberId = idOrNull(rawNumberId);
    const number = numberId === null ? undefined : state.whatsappNumbers.find((n) => n.client_id === clientId && n.account_id === account.id && n.id === numberId);
    if (typeof body.is_test !== 'boolean') return badRequest(res, [{ path: 'is_test', message: 'Booléen attendu.' }]);
    if (!number) return notFound(NUMBER_NOT_FOUND);
    number.is_test = body.is_test;
    send(res, 200, accountViewOf(account));
    return true;
  }
  return false;
}

async function adminRoutes(ctx: Ctx, route: string, clientId: string, isAdmin: boolean): Promise<boolean> {
  const { res, method, body } = ctx;
  const forbid = (): true => { fail(res, 403, 'FORBIDDEN', 'Accès refusé.'); return true; };
  const orgBots = state.bots.filter((b) => b.client_id === clientId);

  // entités
  if (route === '/entities' && method === 'GET') {
    const all = entityView(clientId);
    send(res, 200, ctx.query.get('include_archived') === 'true' ? all : all.filter((e) => e.status === 'active'));
    return true;
  }
  if (route === '/entities' && method === 'POST') {
    if (!isAdmin) return forbid();
    const entity = { id: state.nextIds.entity++, client_id: clientId, name: str(body.name).trim(), status: 'active' as const };
    state.entities.push(entity);
    send(res, 201, { id: entity.id, name: entity.name, status: entity.status, bots: 0, members: 0 });
    return true;
  }
  const entityMatch = /^\/entities\/(\d+)$/.exec(route);
  if (entityMatch && method === 'PATCH') {
    if (!isAdmin) return forbid();
    const entity = state.entities.find((e) => e.id === Number(entityMatch[1]) && e.client_id === clientId);
    if (!entity) { fail(res, 404, 'NOT_FOUND', 'Entité introuvable.'); return true; }
    if (typeof body.name === 'string') entity.name = body.name.trim();
    if (body.status === 'active' || body.status === 'archived') entity.status = body.status;
    send(res, 200, entityView(clientId).find((e) => e.id === entity.id));
    return true;
  }

  // comptes WhatsApp
  if (whatsappAccountRoutes(ctx, route, clientId, isAdmin)) return true;

  // agents IA
  if (route === '/bots' && method === 'GET') { send(res, 200, orgBots.map(botView)); return true; }
  if (route === '/bots' && method === 'POST') {
    if (!isAdmin) return forbid();
    const activeEntities = state.entities.filter((e) => e.client_id === clientId && e.status === 'active');
    const entityId = typeof body.entity_id === 'number' ? body.entity_id : activeEntities.length === 1 ? activeEntities[0].id : null;
    if (entityId === null) {
      fail(res, 400, 'VALIDATION_ERROR', 'Entité à préciser.', [{ path: 'entity_id', message: 'Entité à préciser.' }]);
      return true;
    }
    if (state.bots.some((b) => b.bot_id === str(body.bot_id))) { fail(res, 409, 'CONFLICT', 'Cet identifiant existe déjà.'); return true; }
    const bot: Bot = {
      client_id: clientId,
      bot_id: str(body.bot_id),
      name: str(body.name),
      slug: str(body.bot_id),
      status: 'draft',
      languages: Array.isArray(body.languages) ? (body.languages as string[]) : ['fr'],
      default_language: str(body.default_language) || 'fr',
      system_prompt: (body.system_prompt as Record<string, string> | undefined) ?? {},
      entity_id: entityId,
      allowlist: [],
      status_reason: null,
      unserved: { count: 0, last_at: null },
    };
    state.bots.push(bot);
    send(res, 201, botView(bot));
    return true;
  }
  const botMatch = /^\/bots\/([^/]+)((?:\/[a-z-]+)+)?$/.exec(route);
  if (botMatch) {
    const bot = orgBots.find((b) => b.bot_id === botMatch[1]);
    const sub = botMatch[2];
    if (!bot) {
      // brancher ou activer : le moteur ne distingue pas l'agent IA absent du numéro absent
      const onNumber = (sub === '/number' && method === 'PUT') || sub === '/activate';
      fail(res, 404, 'NOT_FOUND', onNumber ? BOT_OR_NUMBER_NOT_FOUND : BOT_NOT_FOUND);
      return true;
    }
    if (sub && ['/number', '/number/unassign', '/status', '/allowlist', '/activate'].includes(sub)) {
      if (!isAdmin) return forbid();
      if (botActionRoutes(ctx, bot, sub)) return true;
    }
    if (!sub && method === 'GET') { send(res, 200, botView(bot)); return true; }
    if (!sub && method === 'PATCH') {
      if (!isAdmin) return forbid();
      for (const key of ['name', 'default_language'] as const) if (typeof body[key] === 'string') bot[key] = body[key] as string;
      if (typeof body.entity_id === 'number') bot.entity_id = body.entity_id;
      if (Array.isArray(body.languages)) bot.languages = body.languages as string[];
      if (body.system_prompt && typeof body.system_prompt === 'object') bot.system_prompt = body.system_prompt as Record<string, string>;
      send(res, 200, botView(bot));
      return true;
    }
    if (sub === '/simulate' && method === 'POST') {
      send(res, 200, { session_id: 'sess-1', reply: `Réponse simulée à : ${str(body.message)}`, model: 'claude-haiku-4-5' });
      return true;
    }
    if (sub === '/health') {
      send(res, 200, { status: bot.status, status_reason: bot.status_reason, languages: bot.languages, whatsapp: { number: numberSummaryOf(bot) }, crm: { configured: true, connector: 'hubspot', last_error: null, last_error_at: null }, llm: { mode: 'platform', key_configured: false } });
      return true;
    }
    if (sub === '/metrics') { send(res, 200, { leads_total: 23, rdv_total: 9, conversations_total: 40, messages_total: 142 }); return true; }
    if (sub === '/usage') {
      send(res, 200, { totals: { input_tokens: 184000, output_tokens: 39000, cache_read_tokens: 0, cache_creation_tokens: 0, cost_usd: 1.84, calls: 312 }, by_model: [{ model: 'claude-haiku-4-5', calls: 268, cost_usd: 1.12, input_tokens: 152000, output_tokens: 31000 }], by_day: [{ day: '2026-06-01', cost_usd: 0.06, calls: 10 }, { day: '2026-06-02', cost_usd: 0.1, calls: 14 }] });
      return true;
    }
    if (sub === '/leads') {
      send(res, 200, { leads: [{ phone: '+33611111111', name: 'Marie', qualified_data: { budget: 'x' }, last_message_at: '2 min' }], total: 1, page: 1, page_size: 3 });
      return true;
    }
  }

  // réglages : lecture permise à tout membre, comme le moteur
  if (route === '/settings' && method === 'GET') {
    send(res, 200, { visibility: 'all', pool_self_claim: true, reassign: 'managers', transfer: 'managers', takeover: 'owner' });
    return true;
  }
  // utilisateurs, invitations, écriture des réglages (administrateur de l'organisation)
  if (route === '/users' || route.startsWith('/users/') || route.startsWith('/invitations') || route === '/settings') {
    if (!isAdmin) return forbid();
  }
  if (route === '/users' && method === 'GET') { send(res, 200, memberView(clientId)); return true; }
  const userMatch = /^\/users\/(\d+)(\/memberships)?$/.exec(route);
  if (userMatch) {
    const userId = Number(userMatch[1]);
    const own = state.memberships.filter((m) => m.user_id === userId && m.client_id === clientId);
    if (own.length === 0) { fail(res, 404, 'NOT_FOUND', 'Utilisateur introuvable.'); return true; }
    if (userMatch[2] && method === 'PUT') {
      const grants = grantsOf(body.grants);
      state.memberships = state.memberships.filter((m) => !(m.user_id === userId && m.client_id === clientId));
      for (const g of grants) state.memberships.push({ user_id: userId, client_id: clientId, status: 'active', ...g });
    } else if (!userMatch[2] && method === 'PATCH') {
      const status = body.status === 'suspended' ? 'suspended' : 'active';
      for (const m of own) m.status = status;
    }
    send(res, 204);
    return true;
  }
  if (route === '/invitations' && method === 'GET') {
    send(res, 200, state.invitations.filter((i) => i.client_id === clientId).map(({ token: _token, client_id: _c, ...i }) => i));
    return true;
  }
  if (route === '/invitations' && method === 'POST') {
    const email = str(body.email).trim().toLowerCase();
    const id = state.nextIds.invitation++;
    state.invitations.push({ id, client_id: clientId, email, token: `invite-${id}`, grants: grantsOf(body.grants), expires_at: '2099-01-01T00:00:00.000Z', accepted_at: null, created_at: '2026-11-08T00:00:00.000Z' });
    send(res, 201, { email });
    return true;
  }
  const invMatch = /^\/invitations\/(\d+)(\/resend)?$/.exec(route);
  if (invMatch) {
    const inv = state.invitations.find((i) => i.id === Number(invMatch[1]) && i.client_id === clientId);
    if (!inv) { fail(res, 404, 'NOT_FOUND', 'Invitation introuvable.'); return true; }
    if (invMatch[2] && method === 'POST') { send(res, 204); return true; }
    if (!invMatch[2] && method === 'DELETE') {
      state.invitations = state.invitations.filter((i) => i.id !== inv.id);
      send(res, 204);
      return true;
    }
  }
  return false;
}

createServer(async (req, res) => {
  const parsed = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const method = req.method ?? 'GET';
  if (method === 'POST' && parsed.pathname === '/__reset') {
    state = initialState();
    return send(res, 204);
  }
  if (method === 'GET' && parsed.pathname === '/__last-reset-link') {
    return send(res, 200, { link: state.lastResetLink });
  }
  if (!parsed.pathname.startsWith(PREFIX)) return fail(res, 404, 'NOT_FOUND', 'Introuvable.');
  const route = parsed.pathname.slice(PREFIX.length);
  const ctx: Ctx = { req, res, method, query: parsed.searchParams, body: await readBody(req) };

  if (await authRoutes(ctx, route)) return;
  const account = authenticate(req);
  if (!account) return fail(res, 401, 'UNAUTHORIZED', SESSION_MESSAGE);
  if (await sessionAuthRoutes(ctx, route, account)) return;
  const org = resolveOrg(ctx, account);
  if (!org) return;
  if (await adminRoutes(ctx, route, org.client_id, org.role === 'admin')) return;
  fail(res, 404, 'NOT_FOUND', 'Introuvable.');
}).listen(PORT, () => console.log(`[MockEngine] http://localhost:${PORT}`));
