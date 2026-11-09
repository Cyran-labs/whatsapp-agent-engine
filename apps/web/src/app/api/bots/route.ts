import { NextResponse } from 'next/server';
import { CreateBotInput } from '@wabagent/contracts';
import { engineFetch } from '@/lib/engine-fetch';
import { errorResponse } from '@/lib/api-response';
import { jsonResponse } from '@/lib/api-json';

export async function GET(): Promise<NextResponse> {
  try {
    return jsonResponse(await engineFetch('/bots'));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const parsed = CreateBotInput.safeParse(await request.json());
    if (!parsed.success) {
      return jsonResponse(
        { error: { code: 'VALIDATION_ERROR', message: 'Données invalides.', details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } },
        { status: 400 },
      );
    }
    const bot = await engineFetch('/bots', { method: 'POST', body: JSON.stringify(parsed.data) });
    return jsonResponse(bot, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
