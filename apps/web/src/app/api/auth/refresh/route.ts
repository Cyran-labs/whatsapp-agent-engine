import { NextResponse } from 'next/server';
import { engineCall, EngineError } from '@/lib/engine-client';
import { readRefresh, setSession, clearSession } from '@/lib/session';
import { errorResponse } from '@/lib/api-response';
import { jsonResponse } from '@/lib/api-json';
import { SESSION_EXPIRED_MESSAGE } from '@/lib/session-errors';

interface AuthResult { access_token: string; refresh_token: string; user: unknown }

export async function POST(): Promise<NextResponse> {
  try {
    const refresh = await readRefresh();
    if (!refresh) {
      await clearSession();
      throw new EngineError('UNAUTHORIZED', SESSION_EXPIRED_MESSAGE, 401, undefined, 'session.expired');
    }
    const result = await engineCall<AuthResult>('/auth/refresh', { method: 'POST', body: JSON.stringify({ refresh_token: refresh }) });
    await setSession(result);
    return jsonResponse({ user: result.user });
  } catch (err) {
    await clearSession();
    return errorResponse(err);
  }
}
