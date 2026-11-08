import { NextResponse } from 'next/server';
import { engineFetch } from '@/lib/engine-fetch';
import { errorResponse } from '@/lib/api-response';

interface RawBot { bot_id: string; name: string; entity_id?: number }
interface Totals { calls: number; input_tokens: number; output_tokens: number; cost_usd: number }

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const since = new URL(req.url).searchParams.get('since');
    const qs = since ? `?since=${encodeURIComponent(since)}` : '';
    const bots = (await engineFetch('/bots')) as RawBot[];
    const rows = [];
    const total: Totals = { calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
    for (const b of bots) {
      let tt: Totals = { calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 };
      try {
        const u = (await engineFetch(`/bots/${b.bot_id}/usage${qs}`)) as { totals?: Partial<Totals> };
        tt = { calls: u.totals?.calls ?? 0, input_tokens: u.totals?.input_tokens ?? 0, output_tokens: u.totals?.output_tokens ?? 0, cost_usd: u.totals?.cost_usd ?? 0 };
      } catch {
        // usage indisponible : 0
      }
      rows.push({ bot_id: b.bot_id, name: b.name, entity_id: b.entity_id ?? null, ...tt });
      total.calls += tt.calls; total.input_tokens += tt.input_tokens; total.output_tokens += tt.output_tokens; total.cost_usd += tt.cost_usd;
    }
    return NextResponse.json({ rows, total });
  } catch (err) {
    return errorResponse(err);
  }
}
