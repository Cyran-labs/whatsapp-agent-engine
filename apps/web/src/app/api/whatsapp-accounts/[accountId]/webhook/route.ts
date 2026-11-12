import type { NextResponse } from 'next/server';
import { proxyEngine, rejectNonNumericId } from '@/lib/proxy';

/**
 * Clé d'URL d'un compte CM.com : la seule lecture qui la sert (revue 2b-3 M-2). Lue par la boîte webhook de Connexions,
 * jamais par un compteur ni un sélecteur de numéro. Compte Meta : 404 du moteur, qui inscrit lui-même son adresse chez
 * Meta ; le jeton de vérification Meta ne sort jamais du moteur (revue R1 ISO-M5).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ accountId: string }> }): Promise<NextResponse> {
  const { accountId } = await params;
  return rejectNonNumericId(accountId) ?? proxyEngine(`/whatsapp-accounts/${accountId}/webhook`);
}
