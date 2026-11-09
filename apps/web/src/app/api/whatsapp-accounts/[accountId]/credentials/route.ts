import type { NextResponse } from 'next/server';
import { ReplaceWhatsAppCredentialsInput } from '@wabagent/contracts';
import { proxyEngine, rejectNonNumericId } from '@/lib/proxy';

export async function PUT(request: Request, { params }: { params: Promise<{ accountId: string }> }): Promise<NextResponse> {
  const { accountId } = await params;
  return rejectNonNumericId(accountId) ?? proxyEngine(`/whatsapp-accounts/${accountId}/credentials`, { method: 'PUT', body: request, schema: ReplaceWhatsAppCredentialsInput });
}
