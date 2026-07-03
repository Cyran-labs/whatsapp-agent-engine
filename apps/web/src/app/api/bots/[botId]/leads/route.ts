import { NextResponse } from 'next/server';
import { engineFetch } from '@/lib/engine-fetch';
import { errorResponse } from '@/lib/api-response';

const ALLOWED = ['page', 'page_size', 'search', 'rdv'] as const;

export async function GET(req: Request, { params }: { params: Promise<{ botId: string }> }): Promise<NextResponse> {
  try {
    const { botId } = await params;
    const src = new URL(req.url).searchParams;
    const out = new URLSearchParams();
    for (const k of ALLOWED) { const v = src.get(k); if (v !== null) out.set(k, v); }
    const qs = out.toString();
    return NextResponse.json(await engineFetch(`/bots/${botId}/leads${qs ? `?${qs}` : ''}`));
  } catch (err) {
    return errorResponse(err);
  }
}
