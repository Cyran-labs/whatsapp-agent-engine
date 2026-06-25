import { NextResponse } from 'next/server';
import { engineCall } from '@/lib/engine-client';
import { readRefresh, clearSession } from '@/lib/session';

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
  return new NextResponse(null, { status: 204 });
}
