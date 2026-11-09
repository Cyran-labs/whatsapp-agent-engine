import type { NextResponse } from 'next/server';
import { RenameWhatsAppAccountInput } from '@wabagent/contracts';
import { proxyEngine, rejectNonNumericId } from '@/lib/proxy';

type Ctx = { params: Promise<{ accountId: string }> };

export async function GET(_request: Request, { params }: Ctx): Promise<NextResponse> {
  const { accountId } = await params;
  return rejectNonNumericId(accountId) ?? proxyEngine(`/whatsapp-accounts/${accountId}`);
}

export async function PATCH(request: Request, { params }: Ctx): Promise<NextResponse> {
  const { accountId } = await params;
  return rejectNonNumericId(accountId) ?? proxyEngine(`/whatsapp-accounts/${accountId}`, { method: 'PATCH', body: request, schema: RenameWhatsAppAccountInput });
}
