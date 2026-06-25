import { createServer } from 'node:http';

const PORT = 4999;

function send(res: import('node:http').ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function readBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data ? JSON.parse(data) : {}));
  });
}

const user = { id: 1, email: 'demo@wabagent.test', role: 'client_admin', client_id: 'c1', status: 'active' };

createServer(async (req, res) => {
  const url = req.url ?? '';
  if (url.endsWith('/auth/login')) {
    const body = (await readBody(req)) as { email: string; password: string };
    if (body.email === 'demo@wabagent.test' && body.password === 'motdepasse12') {
      return send(res, 200, { access_token: 'access-1', refresh_token: 'refresh-1', user });
    }
    return send(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Identifiants invalides.', request_id: 'r' } });
  }
  if (url.endsWith('/auth/accept-invite')) {
    const body = (await readBody(req)) as { token: string; password: string };
    if (body.token === 'invite-ok' && body.password.length >= 10) {
      return send(res, 200, { access_token: 'access-1', refresh_token: 'refresh-1', user });
    }
    return send(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Invitation invalide ou expirée.', request_id: 'r' } });
  }
  if (url.endsWith('/auth/me')) return send(res, 200, user);
  if (url.endsWith('/auth/logout')) return send(res, 204);
  return send(res, 404, { error: { code: 'NOT_FOUND', message: 'x', request_id: 'r' } });
}).listen(PORT, () => console.log(`[MockEngine] http://localhost:${PORT}`));
