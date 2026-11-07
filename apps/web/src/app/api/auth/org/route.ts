import { NextResponse } from 'next/server';
import { z } from 'zod';
import { engineFetch } from '@/lib/engine-fetch';
import { errorResponse } from '@/lib/api-response';
import { isOpenable, type Me } from '@/lib/organizations';
import { setOrg } from '@/lib/session';

const ChooseOrgInput = z.object({ client_id: z.string().min(1) });

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const parsed = ChooseOrgInput.safeParse(await request.json().catch(() => undefined));
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Données invalides.', details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } },
        { status: 400 },
      );
    }
    const me = await engineFetch<Me>('/auth/me');
    const target = me.organizations.find((o) => o.client_id === parsed.data.client_id);
    if (!target || !isOpenable(target)) {
      return NextResponse.json({ error: { code: 'FORBIDDEN', message: 'Accès refusé.' } }, { status: 403 });
    }
    await setOrg(target.client_id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
