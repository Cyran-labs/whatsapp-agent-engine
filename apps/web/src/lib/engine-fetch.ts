import { engineCall, EngineError } from './engine-client';
import { readAccess, readRefresh, setSession, clearSession } from './session';

interface AuthResult {
  access_token: string;
  refresh_token: string;
  user: unknown;
}

async function call<T>(path: string, access: string | undefined, init?: RequestInit): Promise<T> {
  return engineCall<T>(path, {
    ...init,
    headers: { ...(init?.headers ?? {}), ...(access ? { authorization: `Bearer ${access}` } : {}) },
  });
}

export async function engineFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const access = await readAccess();
  try {
    return await call<T>(path, access, init);
  } catch (err) {
    if (!(err instanceof EngineError) || err.status !== 401) throw err;
    const refresh = await readRefresh();
    if (!refresh) {
      await clearSession();
      throw new EngineError('UNAUTHORIZED', 'Session expirée.', 401);
    }
    let refreshed: AuthResult;
    try {
      refreshed = await engineCall<AuthResult>('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: refresh }),
      });
    } catch {
      await clearSession();
      throw new EngineError('UNAUTHORIZED', 'Session expirée.', 401);
    }
    await setSession(refreshed);
    return call<T>(path, refreshed.access_token, init);
  }
}
