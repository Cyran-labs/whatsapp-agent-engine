import { NextResponse } from 'next/server';
import { AcceptInviteInput } from '@wabagent/contracts';
import { engineCall } from '@/lib/engine-client';
import { setOrg, setSession } from '@/lib/session';
import { errorResponse } from '@/lib/api-response';
import { acceptedOrganization, type Me } from '@/lib/organizations';
import { readValidatedBody } from '@/lib/request-body';
import { jsonResponse } from '@/lib/api-json';

interface AuthResult { access_token: string; refresh_token: string; user: unknown }

/**
 * Compte neuf : toutes les invitations en attente sont appliquées. wab_org est posé sur l'organisation
 * du nom donné par la page (`organization_name`), sinon sur la première.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const parsed = await readValidatedBody(request, AcceptInviteInput);
    if (!parsed.ok) return parsed.response;
    const hint = (parsed.raw as { organization_name?: unknown }).organization_name;
    const organizationName = typeof hint === 'string' ? hint : undefined;

    const result = await engineCall<AuthResult>('/auth/accept-invite', { method: 'POST', body: JSON.stringify(parsed.data) });
    await setSession(result);
    let accepted = null;
    try {
      const me = await engineCall<Me>('/auth/me', { headers: { authorization: `Bearer ${result.access_token}` } });
      accepted = acceptedOrganization([], me.organizations, organizationName);
      if (accepted) await setOrg(me.id, accepted.client_id);
    } catch {
      // le compte est activé : l'organisation active sera résolue au prochain /auth/me
    }
    return jsonResponse({
      user: result.user,
      client_id: accepted?.client_id ?? null,
      organization_name: accepted?.name ?? organizationName ?? '',
    });
  } catch (err) {
    return errorResponse(err);
  }
}
