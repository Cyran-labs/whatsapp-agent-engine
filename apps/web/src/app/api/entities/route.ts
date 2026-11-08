import type { NextResponse } from 'next/server';
import { CreateEntityInput } from '@wabagent/contracts';
import { proxyEngine } from '@/lib/proxy';

export async function GET(request: Request): Promise<NextResponse> {
  const includeArchived = new URL(request.url).searchParams.get('include_archived') === 'true';
  return proxyEngine(includeArchived ? '/entities?include_archived=true' : '/entities');
}

export async function POST(request: Request): Promise<NextResponse> {
  return proxyEngine('/entities', { method: 'POST', body: request, schema: CreateEntityInput, status: 201 });
}
