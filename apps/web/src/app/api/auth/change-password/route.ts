import { NextResponse } from 'next/server';
import { ChangePasswordInput } from '@wabagent/contracts';
import { engineFetch } from '@/lib/engine-fetch';
import { setSession } from '@/lib/session';
import { errorResponse } from '@/lib/api-response';
import { readValidatedBody } from '@/lib/request-body';
import { emptyResponse } from '@/lib/api-json';

interface AuthResult { access_token: string; refresh_token: string; user: unknown }

/** Le moteur révoque toutes les sessions et réémet celle de l'appelant : on remplace les cookies. */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const parsed = await readValidatedBody(request, ChangePasswordInput);
    if (!parsed.ok) return parsed.response;
    const result = await engineFetch<AuthResult>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(parsed.data),
    });
    await setSession(result);
    return emptyResponse(204);
  } catch (err) {
    return errorResponse(err);
  }
}
