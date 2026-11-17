import type { NextResponse } from 'next/server';
import { RequestDisplayNameInput } from '@wabagent/contracts';
import { proxyEngine, rejectNonNumericId } from '@/lib/proxy';

/** Demande d'un nouveau nom d'affichage (lot R2a, spec R2a §5.3, point 3) ; réponse : la vue du numéro relue. */
export async function POST(request: Request, { params }: { params: Promise<{ accountId: string; numberId: string }> }): Promise<NextResponse> {
  const { accountId, numberId } = await params;
  return (
    rejectNonNumericId(accountId) ??
    rejectNonNumericId(numberId) ??
    proxyEngine(`/whatsapp-accounts/${accountId}/numbers/${numberId}/display-name`, { method: 'POST', body: request, schema: RequestDisplayNameInput })
  );
}
