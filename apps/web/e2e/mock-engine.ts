import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { initialState, type Account, type Bot, type Grant, type Invitation, type State } from './mock-state';

const PORT = 4999;
const PREFIX = '/api/admin/v1';
const SESSION_MESSAGE = 'Session expirée.';
const INVALID_INVITE = 'Invitation invalide ou expirée.';

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

function tokens(account: Account) {
  return { access_token: `access-${account.id}`, refresh_token: `refresh-${account.id}` };
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
  const m = /^Bearer access-(\d+)$/.exec(req.headers.authorization ?? '');
  return m ? state.accounts.find((a) => a.id === Number(m[1])) ?? null : null;
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
    if (account && account.password === str(body.password)) send(res, 200, { ...tokens(account), user: meOf(account) });
    else fail(res, 401, 'UNAUTHORIZED', 'Identifiants invalides.');
    return true;
  }
  if (route === '/auth/refresh') {
    const m = /^refresh-(\d+)$/.exec(str(body.refresh_token));
    const account = m ? state.accounts.find((a) => a.id === Number(m[1])) : undefined;
    if (account) send(res, 200, { ...tokens(account), user: meOf(account) });
    else fail(res, 401, 'UNAUTHORIZED', SESSION_MESSAGE);
    return true;
  }
  if (route === '/auth/logout') {
    send(res, 204);
    return true;
  }
  if (route === '/auth/accept-invite') {
    const inv = pendingInvitation(str(body.token));
    if (!inv || state.accounts.some((a) => a.email === inv.email) || str(body.password).length < 10) {
      fail(res, 401, 'UNAUTHORIZED', INVALID_INVITE);
      return true;
    }
    const account: Account = { id: state.nextIds.account++, email: inv.email, password: str(body.password) };
    state.accounts.push(account);
    for (const pending of state.invitations.filter((i) => i.email === inv.email && i.accepted_at === null)) applyInvitation(pending, account.id);
    send(res, 200, { ...tokens(account), user: meOf(account) });
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
    send(res, 204);
    return true;
  }
  if (route === '/auth/reset-password') {
    const accountId = state.resetTokens.get(str(body.token));
    const account = state.accounts.find((a) => a.id === accountId);
    if (!account || str(body.password).length < 10) {
      fail(res, 401, 'UNAUTHORIZED', 'Lien invalide ou expiré.');
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
    if (account.password !== str(body.current_password)) fail(res, 401, 'UNAUTHORIZED', 'Mot de passe actuel incorrect.');
    else {
      account.password = str(body.new_password);
      send(res, 200, { ...tokens(account), user: meOf(account) });
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

function botView(b: Bot) {
  const { client_id: _clientId, ...rest } = b;
  return rest;
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
      numbers: [],
      system_prompt: (body.system_prompt as Record<string, string> | undefined) ?? {},
      entity_id: entityId,
    };
    state.bots.push(bot);
    send(res, 201, botView(bot));
    return true;
  }
  const botMatch = /^\/bots\/([^/]+)(\/[a-z]+)?$/.exec(route);
  if (botMatch) {
    const bot = orgBots.find((b) => b.bot_id === botMatch[1]);
    if (!bot) { fail(res, 404, 'NOT_FOUND', 'Agent IA introuvable.'); return true; }
    const sub = botMatch[2];
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
      send(res, 200, { status: bot.status, numbers: bot.numbers, languages: bot.languages, whatsapp: { validated: true, validated_at: '2026-06-01', error: null }, crm: { configured: true, connector: 'hubspot', last_error: null, last_error_at: null }, llm: { mode: 'platform', key_configured: false } });
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

  // utilisateurs, invitations, réglages (administrateur de l'organisation)
  if (route === '/users' || route.startsWith('/users/') || route.startsWith('/invitations') || route === '/settings') {
    if (!isAdmin) return forbid();
  }
  if (route === '/settings' && method === 'GET') {
    send(res, 200, { visibility: 'all', pool_self_claim: true, reassign: 'managers', transfer: 'managers', takeover: 'owner' });
    return true;
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
    send(res, 200, memberView(clientId).find((m) => m.user_id === userId));
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
    if (invMatch[2] && method === 'POST') { send(res, 200, { email: inv.email }); return true; }
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
