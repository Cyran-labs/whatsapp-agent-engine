import type { NextResponse } from 'next/server';
import { SetMemberStatusInput } from '@wabagent/contracts';
import { proxyEngine, rejectNonNumericId } from '@/lib/proxy';

export async function PATCH(request: Request, { params }: { params: Promise<{ userId: string }> }): Promise<NextResponse> {
  const { userId } = await params;
  return rejectNonNumericId(userId) ?? proxyEngine(`/users/${userId}`, { method: 'PATCH', body: request, schema: SetMemberStatusInput });
}
