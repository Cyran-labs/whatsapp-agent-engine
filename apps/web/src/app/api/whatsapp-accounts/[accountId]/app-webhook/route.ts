import type { NextResponse } from 'next/server';
import { proxyEngine, rejectNonNumericId } from '@/lib/proxy';

/**
 * « Faire pointer vers WABAGENT » (spec R1 §10, question 1) : le moteur remplace le webhook de l'app Meta du compte par
 * l'adresse de ce compte. Réponse (vue du compte et contrôles) et refus (`reason`, `request_id`) relayés tels quels.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ accountId: string }> }): Promise<NextResponse> {
  const { accountId } = await params;
  return rejectNonNumericId(accountId) ?? proxyEngine(`/whatsapp-accounts/${accountId}/app-webhook`, { method: 'POST' });
}
