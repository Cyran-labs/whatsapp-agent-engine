import { NextResponse } from 'next/server';
import { engineCall, EngineError } from '@/lib/engine-client';
import { readRefresh, setSession, clearSession } from '@/lib/session';
import { errorResponse } from '@/lib/api-response';

interface AuthResult { access_token: string; refresh_token: string; user: unknown }

export async function POST(): Promise<NextResponse> {
  try {
    const refresh = await readRefresh();
    if (!refresh) {
      await clearSession();
      throw new EngineError('UNAUTHORIZED', 'Session expirée.', 401);
    }
    const result = await engineCall<AuthResult>('/auth/refresh', { method: 'POST', body: JSON.stringify({ refresh_token: refresh }) });
    await setSession(result);
    return NextResponse.json({ user: result.user });
  } catch (err) {
    await clearSession();
    return errorResponse(err);
  }
}
