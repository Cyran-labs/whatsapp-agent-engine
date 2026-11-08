import type { NextResponse } from 'next/server';
import { SetMembershipsInput } from '@wabagent/contracts';
import { proxyEngine } from '@/lib/proxy';

export async function PUT(request: Request, { params }: { params: Promise<{ userId: string }> }): Promise<NextResponse> {
  const { userId } = await params;
  return proxyEngine(`/users/${encodeURIComponent(userId)}/memberships`, { method: 'PUT', body: request, schema: SetMembershipsInput });
}
