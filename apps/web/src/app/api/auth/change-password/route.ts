import { NextResponse } from 'next/server';
import { ChangePasswordInput } from '@wabagent/contracts';
import { engineFetch } from '@/lib/engine-fetch';
import { setSession } from '@/lib/session';
import { errorResponse } from '@/lib/api-response';

interface AuthResult { access_token: string; refresh_token: string; user: unknown }

/** Le moteur révoque toutes les sessions et réémet celle de l'appelant : on remplace les cookies. */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const parsed = ChangePasswordInput.safeParse(await request.json().catch(() => undefined));
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Données invalides.', details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } },
        { status: 400 },
      );
    }
    const result = await engineFetch<AuthResult>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(parsed.data),
    });
    await setSession(result);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
