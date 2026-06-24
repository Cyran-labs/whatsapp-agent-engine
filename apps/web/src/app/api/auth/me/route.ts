import { NextResponse } from 'next/server';
import { engineFetch } from '@/lib/engine-fetch';
import { errorResponse } from '@/lib/api-response';

export async function GET(): Promise<NextResponse> {
  try {
    const user = await engineFetch('/auth/me');
    return NextResponse.json({ user });
  } catch (err) {
    return errorResponse(err);
  }
}
