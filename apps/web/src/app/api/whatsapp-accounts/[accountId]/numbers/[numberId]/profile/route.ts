import type { NextResponse } from 'next/server';
import { UpdateWhatsAppBusinessProfileInput } from '@wabagent/contracts';
import { proxyEngine, rejectNonNumericId } from '@/lib/proxy';

type Params = { params: Promise<{ accountId: string; numberId: string }> };

/** Profil WhatsApp d'un numéro, lu chez Meta par le moteur (lot R2a, spec R2a §5.2, §6.4). */
export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const { accountId, numberId } = await params;
  return (
    rejectNonNumericId(accountId) ??
    rejectNonNumericId(numberId) ??
    proxyEngine(`/whatsapp-accounts/${accountId}/numbers/${numberId}/profile`)
  );
}

/** Champs modifiés du profil (un champ vidé est envoyé vide) ; réponse : le profil relu. Le corps n'est jamais journalisé. */
export async function PUT(request: Request, { params }: Params): Promise<NextResponse> {
  const { accountId, numberId } = await params;
  return (
    rejectNonNumericId(accountId) ??
    rejectNonNumericId(numberId) ??
    proxyEngine(`/whatsapp-accounts/${accountId}/numbers/${numberId}/profile`, { method: 'PUT', body: request, schema: UpdateWhatsAppBusinessProfileInput })
  );
}
