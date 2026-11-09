import type { NextResponse } from 'next/server';
import { UnassignNumberInput } from '@wabagent/contracts';
import { proxyEngine } from '@/lib/proxy';

// `botId` est l'identifiant texte (slug) de l'agent IA : encodé dans le chemin, jamais contrôlé comme un entier.
type Ctx = { params: Promise<{ botId: string }> };

/** Débrancher le numéro : `expected_number_id` (numéro affiché par l'écran) obligatoire, contrôlé par le moteur. */
export async function POST(request: Request, { params }: Ctx): Promise<NextResponse> {
  const { botId } = await params;
  return proxyEngine(`/bots/${encodeURIComponent(botId)}/number/unassign`, { method: 'POST', body: request, schema: UnassignNumberInput });
}
