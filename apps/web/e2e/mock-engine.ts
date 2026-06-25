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
const bots: Record<string, unknown>[] = [];

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

  return send(res, 404, { error: { code: 'NOT_FOUND', message: 'x', request_id: 'r' } });
}).listen(PORT, () => console.log(`[MockEngine] http://localhost:${PORT}`));
