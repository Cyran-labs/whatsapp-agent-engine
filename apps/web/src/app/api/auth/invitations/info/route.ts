import { NextResponse } from 'next/server';
import { InvitationInfoInput, type InvitationInfo } from '@wabagent/contracts';
import { engineCall } from '@/lib/engine-client';
import { errorResponse } from '@/lib/api-response';
import { readValidatedBody } from '@/lib/request-body';
import { jsonResponse } from '@/lib/api-json';

/** Public : le jeton du lien est la seule clé, aucune session n'est envoyée au moteur. */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const parsed = await readValidatedBody(request, InvitationInfoInput);
    if (!parsed.ok) return parsed.response;
    const info = await engineCall<InvitationInfo>('/auth/invitations/info', {
      method: 'POST',
      body: JSON.stringify(parsed.data),
    });
    return jsonResponse(info);
  } catch (err) {
    return errorResponse(err);
  }
}
