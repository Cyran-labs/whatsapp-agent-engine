import type { NextResponse } from 'next/server';
import { CreateWhatsAppAccountInput } from '@wabagent/contracts';
import { proxyEngine } from '@/lib/proxy';

export async function GET(): Promise<NextResponse> {
  return proxyEngine('/whatsapp-accounts');
}

export async function POST(request: Request): Promise<NextResponse> {
  return proxyEngine('/whatsapp-accounts', { method: 'POST', body: request, schema: CreateWhatsAppAccountInput, status: 201 });
}
