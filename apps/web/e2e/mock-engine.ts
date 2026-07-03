import { createServer } from 'node:http';

const PORT = 4999;

function send(res: import('node:http').ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}
function readBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data ? JSON.parse(data) : {}));
  });
}

const user = { id: 1, email: 'demo@wabagent.test', role: 'client_admin', client_id: 'c1', status: 'active' };
const bots: Record<string, unknown>[] = [
  { bot_id: 'demo-1', name: 'Support technique', slug: 'support-technique', status: 'active', languages: ['fr'], default_language: 'fr', numbers: ['+33612000047'], system_prompt: { fr: 'Tu es un agent de support.' } },
];

createServer(async (req, res) => {
  const url = (req.url ?? '').split('?')[0];
  const method = req.method ?? 'GET';

  if (url.endsWith('/auth/login')) {
    const body = await readBody(req);
    if (body.email === 'demo@wabagent.test' && body.password === 'motdepasse12') return send(res, 200, { access_token: 'access-1', refresh_token: 'refresh-1', user });
    return send(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Identifiants invalides.', request_id: 'r' } });
  }
  if (url.endsWith('/auth/accept-invite')) {
    const body = await readBody(req);
    if (body.token === 'invite-ok' && typeof body.password === 'string' && body.password.length >= 10) {
      return send(res, 200, { access_token: 'access-1', refresh_token: 'refresh-1', user });
    }
    return send(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Invitation invalide ou expirée.', request_id: 'r' } });
  }
  if (url.endsWith('/auth/me')) return send(res, 200, user);
  if (url.endsWith('/auth/logout')) return send(res, 204);

  // /bots
  if (url.endsWith('/bots') && method === 'GET') return send(res, 200, bots);
  if (url.endsWith('/bots') && method === 'POST') {
    const body = await readBody(req);
    const detail = { ...body, status: 'draft', numbers: [] };
    bots.push(detail);
    return send(res, 201, detail);
  }
  // /bots/:id/simulate
  if (url.endsWith('/simulate') && method === 'POST') {
    const body = await readBody(req);
    return send(res, 200, { session_id: 'sess-1', reply: `Réponse simulée à : ${String(body.message)}`, model: 'claude-haiku-4-5' });
  }
  // /bots/:id (PATCH)
  if (/\/bots\/[^/]+$/.test(url) && method === 'PATCH') {
    const body = await readBody(req);
    return send(res, 200, { ...body, status: 'draft', numbers: [] });
  }

  // dashboard endpoints (spécifiques AVANT le GET détail générique)
  if (/\/bots\/[^/]+\/health$/.test(url) && method === 'GET') return send(res, 200, { status: 'active', numbers: ['+33612000047'], languages: ['fr'], whatsapp: { validated: true, validated_at: '2026-06-01', error: null }, crm: { configured: true, connector: 'hubspot', last_error: null, last_error_at: null }, llm: { mode: 'platform', key_configured: false } });
  if (/\/bots\/[^/]+\/metrics$/.test(url) && method === 'GET') return send(res, 200, { leads_total: 23, rdv_total: 9, conversations_total: 40, messages_total: 142 });
  if (/\/bots\/[^/]+\/usage/.test(url) && method === 'GET') return send(res, 200, { totals: { input_tokens: 184000, output_tokens: 39000, cache_read_tokens: 0, cache_creation_tokens: 0, cost_usd: 1.84, calls: 312 }, by_model: [{ model: 'claude-haiku-4-5', calls: 268, cost_usd: 1.12, input_tokens: 152000, output_tokens: 31000 }], by_day: [{ day: '2026-06-01', cost_usd: 0.06, calls: 10 }, { day: '2026-06-02', cost_usd: 0.1, calls: 14 }] });
  if (/\/bots\/[^/]+\/leads/.test(url) && method === 'GET') return send(res, 200, { leads: [{ phone: '+33611111111', name: 'Marie', qualified_data: { budget: 'x' }, last_message_at: '2 min' }], total: 1, page: 1, page_size: 3 });
  // GET /bots/:id (détail, pour le layout agent — doit être APRÈS les routes spécifiques)
  if (/\/bots\/[^/]+$/.test(url) && method === 'GET') { const id = url.split('/').pop(); return send(res, 200, bots.find((b) => b.bot_id === id) ?? bots[0]); }

  return send(res, 404, { error: { code: 'NOT_FOUND', message: 'x', request_id: 'r' } });
}).listen(PORT, () => console.log(`[MockEngine] http://localhost:${PORT}`));
