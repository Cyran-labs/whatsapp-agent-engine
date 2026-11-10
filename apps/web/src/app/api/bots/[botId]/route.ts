import { NextResponse } from 'next/server';
import { UpdateBotInput } from '@wabagent/contracts';
import { engineFetch } from '@/lib/engine-fetch';
import { errorResponse } from '@/lib/api-response';
import { jsonResponse } from '@/lib/api-json';
import { proxyEngine } from '@/lib/proxy';

export async function GET(_req: Request, { params }: { params: Promise<{ botId: string }> }): Promise<NextResponse> {
  try {
    const { botId } = await params;
    return jsonResponse(await engineFetch(`/bots/${encodeURIComponent(botId)}`));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ botId: string }> }): Promise<NextResponse> {
  const { botId } = await params;
  return proxyEngine(`/bots/${encodeURIComponent(botId)}`, { method: 'PATCH', body: request, schema: UpdateBotInput });
}
