import { NextResponse } from 'next/server';
import { UpdateBotInput } from '@wabagent/contracts';
import { engineFetch } from '@/lib/engine-fetch';
import { errorResponse } from '@/lib/api-response';

export async function GET(_req: Request, { params }: { params: Promise<{ botId: string }> }): Promise<NextResponse> {
  try {
    const { botId } = await params;
    return NextResponse.json(await engineFetch(`/bots/${botId}`));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ botId: string }> }): Promise<NextResponse> {
  try {
    const { botId } = await params;
    const parsed = UpdateBotInput.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Données invalides.', details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } },
        { status: 400 },
      );
    }
    const bot = await engineFetch(`/bots/${encodeURIComponent(botId)}`, { method: 'PATCH', body: JSON.stringify(parsed.data) });
    return NextResponse.json(bot);
  } catch (err) {
    return errorResponse(err);
  }
}
