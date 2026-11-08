import type { NextResponse } from 'next/server';
import { proxyEngine } from '@/lib/proxy';

export async function GET(): Promise<NextResponse> {
  return proxyEngine('/users');
}
