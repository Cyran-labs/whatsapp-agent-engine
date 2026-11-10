import { NextResponse } from 'next/server';
import { engineFetch } from '@/lib/engine-fetch';
import { EngineError } from '@/lib/engine-client';
import { errorResponse } from '@/lib/api-response';
import { jsonResponse } from '@/lib/api-json';
import { readUsdEurRate } from '@/lib/money';
import { sumUsage, type UsageRow, type UsageSummary } from '@/lib/usage';
import type { Me, OrganizationSummary } from '@/lib/organizations';
import { readOrg } from '@/lib/session';

interface RawBot { bot_id: string; name: string; entity_id?: number }
interface Totals { calls: number; input_tokens: number; output_tokens: number; cost_usd: number }

/**
 * Organisation que le moteur prendra pour cette requête : celle du cookie, ou la seule du membre sans cookie. `undefined`
 * quand elle est indéterminée (cookie absent avec plusieurs organisations, cookie inconnu) : le moteur décide alors.
 */
function engineActiveOrg(me: Me, cookie: string | undefined): OrganizationSummary | undefined {
  if (cookie !== undefined) return me.organizations.find((o) => o.client_id === cookie);
  return me.organizations.length === 1 ? me.organizations[0] : undefined;
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    // Coûts réservés à l'admin (spec refonte de la navigation, 9.1) : un autre rôle est refusé avant toute lecture, même
    // quand l'organisation n'a aucun agent IA (aucun appel à /usage ne remonterait alors le refus du moteur). Le moteur
    // reste l'autorité : il refuse aussi chaque /usage.
    const me = await engineFetch<Me>('/auth/me');
    const active = engineActiveOrg(me, await readOrg(me.id));
    if (active !== undefined && active.role !== 'admin') throw new EngineError('FORBIDDEN', 'Accès refusé.', 403);
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
