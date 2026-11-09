import type { NextResponse } from 'next/server';
import { AssignNumberInput } from '@wabagent/contracts';
import { proxyEngine } from '@/lib/proxy';

// `botId` est l'identifiant texte (slug) de l'agent IA : encodé dans le chemin, jamais contrôlé comme un entier.
type Ctx = { params: Promise<{ botId: string }> };

export async function PUT(request: Request, { params }: Ctx): Promise<NextResponse> {
  const { botId } = await params;
  return proxyEngine(`/bots/${encodeURIComponent(botId)}/number`, { method: 'PUT', body: request, schema: AssignNumberInput });
}

export async function DELETE(_request: Request, { params }: Ctx): Promise<NextResponse> {
  const { botId } = await params;
  return proxyEngine(`/bots/${encodeURIComponent(botId)}/number`, { method: 'DELETE' });
}
