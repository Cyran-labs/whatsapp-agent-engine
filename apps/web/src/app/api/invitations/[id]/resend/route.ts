import type { NextResponse } from 'next/server';
import { proxyEngine, rejectNonNumericId } from '@/lib/proxy';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  return rejectNonNumericId(id) ?? proxyEngine(`/invitations/${id}/resend`, { method: 'POST' });
}
