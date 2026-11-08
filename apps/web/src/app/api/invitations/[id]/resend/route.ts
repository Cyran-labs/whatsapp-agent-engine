import type { NextResponse } from 'next/server';
import { proxyEngine } from '@/lib/proxy';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  return proxyEngine(`/invitations/${encodeURIComponent(id)}/resend`, { method: 'POST' });
}
