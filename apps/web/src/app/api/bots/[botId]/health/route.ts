import { NextResponse } from 'next/server';
import { engineFetch } from '@/lib/engine-fetch';
import { errorResponse } from '@/lib/api-response';

export async function GET(_req: Request, { params }: { params: Promise<{ botId: string }> }): Promise<NextResponse> {
  try {
    const { botId } = await params;
    return NextResponse.json(await engineFetch(`/bots/${botId}/health`));
  } catch (err) {
    return errorResponse(err);
  }
}
