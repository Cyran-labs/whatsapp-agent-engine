import { NextResponse } from 'next/server';
import { engineFetch } from '@/lib/engine-fetch';
import { errorResponse } from '@/lib/api-response';
import { resolveActiveOrg, type Me } from '@/lib/organizations';
import { clearOrg, readOrg, setOrg } from '@/lib/session';

export async function GET(): Promise<NextResponse> {
  try {
    const user = await engineFetch<Me>('/auth/me');
    const cookie = await readOrg();
    const active = resolveActiveOrg(user.organizations, cookie);
    const activeId = active?.client_id ?? null;
    if (activeId !== (cookie ?? null)) {
      if (activeId) await setOrg(activeId);
      else await clearOrg();
    }
    return NextResponse.json({ user, active_client_id: activeId });
  } catch (err) {
    return errorResponse(err);
  }
}
