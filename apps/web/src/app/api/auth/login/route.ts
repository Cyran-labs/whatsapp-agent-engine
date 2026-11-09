import { NextResponse } from 'next/server';
import { LoginInput } from '@wabagent/contracts';
import { engineCall } from '@/lib/engine-client';
import { setSession } from '@/lib/session';
import { errorResponse } from '@/lib/api-response';
import { readValidatedBody } from '@/lib/request-body';
import { jsonResponse } from '@/lib/api-json';

interface AuthResult { access_token: string; refresh_token: string; user: unknown }

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const parsed = await readValidatedBody(request, LoginInput);
    if (!parsed.ok) return parsed.response;
    const result = await engineCall<AuthResult>('/auth/login', { method: 'POST', body: JSON.stringify(parsed.data) });
    await setSession(result);
    return jsonResponse({ user: result.user });
  } catch (err) {
    return errorResponse(err);
  }
}
