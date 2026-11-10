import { NextResponse } from 'next/server';
import { engineFetch } from '@/lib/engine-fetch';
import { errorResponse } from '@/lib/api-response';
import { jsonResponse } from '@/lib/api-json';
import { readUsdEurRate } from '@/lib/money';

export async function GET(req: Request, { params }: { params: Promise<{ botId: string }> }): Promise<NextResponse> {
  try {
    const { botId } = await params;
    const since = new URL(req.url).searchParams.get('since');
    const qs = since ? `?since=${encodeURIComponent(since)}` : '';
    const usage = await engineFetch(`/bots/${encodeURIComponent(botId)}/usage${qs}`);
    // Taux dollar vers euro fixé par la plateforme (recette Q-2) : lu ici, côté serveur, jamais dans le navigateur.
    const withRate = typeof usage === 'object' && usage !== null && !Array.isArray(usage)
      ? { ...usage, usd_eur_rate: readUsdEurRate(process.env) }
      : usage;
    return jsonResponse(withRate);
  } catch (err) {
    return errorResponse(err);
  }
}
