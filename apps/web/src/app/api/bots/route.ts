import type { NextResponse } from 'next/server';
import { CreateBotInput } from '@wabagent/contracts';
import { engineFetch } from '@/lib/engine-fetch';
import { errorResponse } from '@/lib/api-response';
import { jsonResponse } from '@/lib/api-json';
import { proxyEngine } from '@/lib/proxy';

export async function GET(): Promise<NextResponse> {
  try {
    return jsonResponse(await engineFetch('/bots'));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  return proxyEngine('/bots', { method: 'POST', body: request, schema: CreateBotInput, status: 201 });
}
