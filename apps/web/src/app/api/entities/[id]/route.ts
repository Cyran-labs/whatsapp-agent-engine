import type { NextResponse } from 'next/server';
import { UpdateEntityInput } from '@wabagent/contracts';
import { proxyEngine } from '@/lib/proxy';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  return proxyEngine(`/entities/${encodeURIComponent(id)}`, { method: 'PATCH', body: request, schema: UpdateEntityInput });
}
