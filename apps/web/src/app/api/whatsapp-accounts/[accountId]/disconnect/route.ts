import type { NextResponse } from 'next/server';
import { proxyEngine, rejectNonNumericId } from '@/lib/proxy';

export async function POST(_request: Request, { params }: { params: Promise<{ accountId: string }> }): Promise<NextResponse> {
  const { accountId } = await params;
  return rejectNonNumericId(accountId) ?? proxyEngine(`/whatsapp-accounts/${accountId}/disconnect`, { method: 'POST' });
}
