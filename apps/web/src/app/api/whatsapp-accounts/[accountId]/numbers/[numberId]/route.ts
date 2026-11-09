import type { NextResponse } from 'next/server';
import { SetWhatsAppNumberTestFlagInput } from '@wabagent/contracts';
import { proxyEngine, rejectNonNumericId } from '@/lib/proxy';

export async function PATCH(request: Request, { params }: { params: Promise<{ accountId: string; numberId: string }> }): Promise<NextResponse> {
  const { accountId, numberId } = await params;
  return (
    rejectNonNumericId(accountId) ??
    rejectNonNumericId(numberId) ??
    proxyEngine(`/whatsapp-accounts/${accountId}/numbers/${numberId}`, { method: 'PATCH', body: request, schema: SetWhatsAppNumberTestFlagInput })
  );
}
