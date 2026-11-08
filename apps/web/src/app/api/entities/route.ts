import { NextResponse } from 'next/server';
import { engineFetch } from '@/lib/engine-fetch';
import { errorResponse } from '@/lib/api-response';

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const includeArchived = new URL(request.url).searchParams.get('include_archived') === 'true';
    return NextResponse.json(await engineFetch(includeArchived ? '/entities?include_archived=true' : '/entities'));
  } catch (err) {
    return errorResponse(err);
  }
}
