import { NextResponse } from 'next/server';
import { ForgotPasswordInput } from '@wabagent/contracts';
import { EngineError, engineCall } from '@/lib/engine-client';
import { errorResponse } from '@/lib/api-response';

/**
 * Public. La réponse ne dépend pas de l'existence du compte : tout refus 4xx du moteur devient un 204.
 * Seuls la limitation de débit (429, sans lien avec le compte) et les erreurs 5xx sont propagées.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const parsed = ForgotPasswordInput.safeParse(await request.json().catch(() => undefined));
    if (!parsed.success) {
      return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Données invalides.' } }, { status: 400 });
    }
    await engineCall<void>('/auth/forgot-password', { method: 'POST', body: JSON.stringify(parsed.data) });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof EngineError && err.status >= 400 && err.status < 500 && err.status !== 429) {
      return new NextResponse(null, { status: 204 });
    }
    return errorResponse(err);
  }
}
