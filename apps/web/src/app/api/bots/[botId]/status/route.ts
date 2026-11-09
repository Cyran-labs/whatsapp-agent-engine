import type { NextResponse } from 'next/server';
import { SetBotStatusInput } from '@wabagent/contracts';
import { proxyEngine } from '@/lib/proxy';

export async function PUT(request: Request, { params }: { params: Promise<{ botId: string }> }): Promise<NextResponse> {
  const { botId } = await params;
  return proxyEngine(`/bots/${encodeURIComponent(botId)}/status`, { method: 'PUT', body: request, schema: SetBotStatusInput });
}
