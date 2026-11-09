import type { NextResponse } from 'next/server';
import { ActivateBotInput } from '@wabagent/contracts';
import { proxyEngine } from '@/lib/proxy';

export async function POST(request: Request, { params }: { params: Promise<{ botId: string }> }): Promise<NextResponse> {
  const { botId } = await params;
  return proxyEngine(`/bots/${encodeURIComponent(botId)}/activate`, { method: 'POST', body: request, schema: ActivateBotInput });
}
