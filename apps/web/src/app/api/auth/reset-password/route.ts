import { NextResponse } from 'next/server';
import { ResetPasswordInput } from '@wabagent/contracts';
import { engineCall } from '@/lib/engine-client';
import { errorResponse } from '@/lib/api-response';
import { readValidatedBody } from '@/lib/request-body';
import { emptyResponse } from '@/lib/api-json';

/** Public : le jeton du lien est la seule clé. 204 en cas de succès, 401 si le lien est invalide ou expiré. */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const parsed = await readValidatedBody(request, ResetPasswordInput);
    if (!parsed.ok) return parsed.response;
    await engineCall<void>('/auth/reset-password', { method: 'POST', body: JSON.stringify(parsed.data) });
    return emptyResponse(204);
  } catch (err) {
    return errorResponse(err);
  }
}
