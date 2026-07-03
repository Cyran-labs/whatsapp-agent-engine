import { NextResponse } from 'next/server';
import { engineFetch } from '@/lib/engine-fetch';
import { errorResponse } from '@/lib/api-response';

export async function GET(req: Request, { params }: { params: Promise<{ botId: string }> }): Promise<NextResponse> {
  try {
    const { botId } = await params;
    const since = new URL(req.url).searchParams.get('since');
    const qs = since ? `?since=${encodeURIComponent(since)}` : '';
    return NextResponse.json(await engineFetch(`/bots/${botId}/usage${qs}`));
  } catch (err) {
    return errorResponse(err);
  }
}
