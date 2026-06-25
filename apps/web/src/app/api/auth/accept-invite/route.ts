import { NextResponse } from 'next/server';
import { AcceptInviteInput } from '@wabagent/contracts';
import { engineCall } from '@/lib/engine-client';
import { setSession } from '@/lib/session';
import { errorResponse } from '@/lib/api-response';

interface AuthResult { access_token: string; refresh_token: string; user: unknown }

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const parsed = AcceptInviteInput.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Données invalides.', details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } },
        { status: 400 },
      );
    }
    const result = await engineCall<AuthResult>('/auth/accept-invite', { method: 'POST', body: JSON.stringify(parsed.data) });
    await setSession(result);
    return NextResponse.json({ user: result.user });
  } catch (err) {
    return errorResponse(err);
  }
}
