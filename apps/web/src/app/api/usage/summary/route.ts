import { NextResponse } from 'next/server';
import { engineFetch } from '@/lib/engine-fetch';
import { EngineError } from '@/lib/engine-client';
import { errorResponse } from '@/lib/api-response';
import { jsonResponse } from '@/lib/api-json';
import { readUsdEurRate } from '@/lib/money';
import { sumUsage, type UsageRow, type UsageSummary } from '@/lib/usage';

interface RawBot { bot_id: string; name: string; entity_id?: number }
interface Totals { calls: number; input_tokens: number; output_tokens: number; cost_usd: number }

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const since = new URL(req.url).searchParams.get('since');
    const qs = since ? `?since=${encodeURIComponent(since)}` : '';
    const bots = (await engineFetch('/bots')) as RawBot[];
    const rows: UsageRow[] = [];
    for (const b of bots) {
      const entity_id = b.entity_id ?? null;
      try {
        const u = (await engineFetch(`/bots/${encodeURIComponent(b.bot_id)}/usage${qs}`)) as { totals?: Partial<Totals> };
        rows.push({
          bot_id: b.bot_id, name: b.name, entity_id,
          calls: u.totals?.calls ?? 0, input_tokens: u.totals?.input_tokens ?? 0,
          output_tokens: u.totals?.output_tokens ?? 0, cost_usd: u.totals?.cost_usd ?? 0,
        });
      } catch (err) {
        // Coûts refusés (réservés à l'admin, spec refonte de la navigation 9.1) : toute la réponse est ce refus, jamais
        // une ligne « indisponible » qui laisserait croire à une panne.
        if (err instanceof EngineError && err.status === 403) throw err;
        // Lecture impossible : la ligne reste, sans chiffre. Un usage inconnu n'est jamais 0.
        rows.push({ bot_id: b.bot_id, name: b.name, entity_id, unavailable: true });
      }
    }
    const summary: UsageSummary = { rows, total: sumUsage(rows), partial: rows.some((r) => 'unavailable' in r), usd_eur_rate: readUsdEurRate(process.env) };
    return jsonResponse(summary);
  } catch (err) {
    return errorResponse(err);
  }
}
