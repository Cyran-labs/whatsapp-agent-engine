import { NextResponse } from 'next/server';
import { engineFetch } from '@/lib/engine-fetch';
import { errorResponse } from '@/lib/api-response';
import { resolveActiveOrg, type Me } from '@/lib/organizations';
import { clearOrg, readOrg, setOrg } from '@/lib/session';
import { jsonResponse } from '@/lib/api-json';

export async function GET(): Promise<NextResponse> {
  try {
    const user = await engineFetch<Me>('/auth/me');
    // Cookie posé par un autre compte du navigateur, ou ancien format : vu comme absent.
    const cookie = await readOrg(user.id);
    const active = resolveActiveOrg(user.organizations, cookie);
    const activeId = active?.client_id ?? null;
    if (activeId !== (cookie ?? null)) {
      if (activeId) await setOrg(user.id, activeId);
      else await clearOrg();
    }
    return jsonResponse({ user, active_client_id: activeId });
  } catch (err) {
    return errorResponse(err);
  }
}
