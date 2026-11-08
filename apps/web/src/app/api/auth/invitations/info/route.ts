import { NextResponse } from 'next/server';
import { InvitationInfoInput, type InvitationInfo } from '@wabagent/contracts';
import { engineCall } from '@/lib/engine-client';
import { errorResponse } from '@/lib/api-response';

/** Public : le jeton du lien est la seule clé, aucune session n'est envoyée au moteur. */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const parsed = InvitationInfoInput.safeParse(await request.json().catch(() => undefined));
    if (!parsed.success) {
      return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Données invalides.' } }, { status: 400 });
    }
    const info = await engineCall<InvitationInfo>('/auth/invitations/info', {
      method: 'POST',
      body: JSON.stringify(parsed.data),
    });
    return NextResponse.json(info);
  } catch (err) {
    return errorResponse(err);
  }
}
