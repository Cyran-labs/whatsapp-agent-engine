import type { NextResponse } from 'next/server';
import { proxyEngine, rejectNonNumericId } from '@/lib/proxy';

/**
 * Clé d'URL et jeton de vérification du compte : la seule lecture qui les sert (revue 2b-3 M-2). Lue par la boîte
 * webhook de Connexions, jamais par un compteur ni un sélecteur de numéro.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ accountId: string }> }): Promise<NextResponse> {
  const { accountId } = await params;
  return rejectNonNumericId(accountId) ?? proxyEngine(`/whatsapp-accounts/${accountId}/webhook`);
}
