import { NextResponse } from 'next/server';
import { AcceptInvitationAsMemberInput } from '@wabagent/contracts';
import { engineFetch } from '@/lib/engine-fetch';
import { errorResponse } from '@/lib/api-response';
import { acceptedOrganization, type Me } from '@/lib/organizations';
import { setOrg } from '@/lib/session';
import { readValidatedBody } from '@/lib/request-body';
import { jsonResponse } from '@/lib/api-json';

/**
 * Sous session : accepte l'invitation, puis pose wab_org sur l'organisation qui vient d'apparaître
 * dans /auth/me. `organization_name` (indice de la page) départage si plusieurs apparaissent.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const parsed = await readValidatedBody(request, AcceptInvitationAsMemberInput);
    if (!parsed.ok) return parsed.response;
    const hint = (parsed.raw as { organization_name?: unknown }).organization_name;
    const organizationName = typeof hint === 'string' ? hint : undefined;

    const before = await engineFetch<Me>('/auth/me');
    await engineFetch('/auth/invitations/accept', { method: 'POST', body: JSON.stringify(parsed.data) });
    let accepted = null;
    try {
      const after = await engineFetch<Me>('/auth/me');
      accepted = acceptedOrganization(before.organizations, after.organizations, organizationName);
    } catch {
      // l'invitation est acceptée : l'organisation active sera résolue au prochain /auth/me
    }
    if (accepted) await setOrg(before.id, accepted.client_id);
    return jsonResponse({
      client_id: accepted?.client_id ?? null,
      organization_name: accepted?.name ?? organizationName ?? '',
    });
  } catch (err) {
    return errorResponse(err);
  }
}
