import { NextResponse } from 'next/server';
import { engineCall } from '@/lib/engine-client';
import { readRefresh, clearSession } from '@/lib/session';
import { emptyResponse } from '@/lib/api-json';

export async function POST(_request: Request): Promise<NextResponse> {
  const refresh = await readRefresh();
  if (refresh) {
    try {
      await engineCall('/auth/logout', { method: 'POST', body: JSON.stringify({ refresh_token: refresh }) });
    } catch {
      // logout best-effort : on efface la session locale quoi qu'il arrive
    }
  }
  await clearSession();
  return emptyResponse(204);
}
