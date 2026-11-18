import type { NextResponse } from 'next/server';
import { PROFILE_PHOTO_MAX_BYTES, PROFILE_PHOTO_TYPES } from '@wabagent/contracts';
import { proxyEngineBinary, rejectNonNumericId } from '@/lib/proxy';

/**
 * Photo du profil WhatsApp d'un numéro (lot R2a, spec R2a §5.2, point 6) : corps binaire JPEG ou PNG de 5 Mo au plus,
 * refusé par le BFF sans appel au moteur sinon ; réponse : le profil relu.
 */
export async function POST(request: Request, { params }: { params: Promise<{ accountId: string; numberId: string }> }): Promise<NextResponse> {
  const { accountId, numberId } = await params;
  return (
    rejectNonNumericId(accountId) ??
    rejectNonNumericId(numberId) ??
    proxyEngineBinary(`/whatsapp-accounts/${accountId}/numbers/${numberId}/profile/photo`, request, PROFILE_PHOTO_TYPES, PROFILE_PHOTO_MAX_BYTES)
  );
}
