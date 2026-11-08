import type { NextResponse } from 'next/server';
import { CreateInvitationInput } from '@wabagent/contracts';
import { proxyEngine } from '@/lib/proxy';

export async function GET(): Promise<NextResponse> {
  return proxyEngine('/invitations');
}

export async function POST(request: Request): Promise<NextResponse> {
  return proxyEngine('/invitations', { method: 'POST', body: request, schema: CreateInvitationInput, status: 201 });
}
