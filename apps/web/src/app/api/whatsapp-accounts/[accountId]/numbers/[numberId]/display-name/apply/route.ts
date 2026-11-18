import type { NextResponse } from 'next/server';
import { ApplyDisplayNameInput } from '@wabagent/contracts';
import { proxyEngine, rejectNonNumericId } from '@/lib/proxy';

/**
 * Application du nom approuvé avec le code de vérification en deux étapes (lot R2a, spec R2a §5.3, point 4) ; réponse :
 * la vue du numéro relue. Le code n'est ni journalisé ni renvoyé : il ne fait que traverser cette requête.
 */
export async function POST(request: Request, { params }: { params: Promise<{ accountId: string; numberId: string }> }): Promise<NextResponse> {
  const { accountId, numberId } = await params;
  return (
    rejectNonNumericId(accountId) ??
    rejectNonNumericId(numberId) ??
    proxyEngine(`/whatsapp-accounts/${accountId}/numbers/${numberId}/display-name/apply`, { method: 'POST', body: request, schema: ApplyDisplayNameInput })
  );
}
