import { NextResponse } from 'next/server';
import { InvitationInfoInput, type InvitationInfo } from '@wabagent/contracts';
import { engineCall } from '@/lib/engine-client';
import { errorResponse } from '@/lib/api-response';
import { jsonResponse } from '@/lib/api-json';

/** Public : le jeton du lien est la seule clé, aucune session n'est envoyée au moteur. */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const parsed = InvitationInfoInput.safeParse(await request.json().catch(() => undefined));
    if (!parsed.success) {
      return jsonResponse({ error: { code: 'VALIDATION_ERROR', message: 'Données invalides.' } }, { status: 400 });
    }
    const info = await engineCall<InvitationInfo>('/auth/invitations/info', {
      method: 'POST',
      body: JSON.stringify(parsed.data),
    });
    return jsonResponse(info);
  } catch (err) {
    return errorResponse(err);
  }
}
