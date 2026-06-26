import { NextResponse } from 'next/server';
import { engineFetch } from '@/lib/engine-fetch';
import { errorResponse } from '@/lib/api-response';

interface RawBot { bot_id: string; name: string; slug?: string; status: string; languages?: string[]; default_language?: string; numbers?: string[] }

export async function GET(): Promise<NextResponse> {
  try {
    const bots = (await engineFetch('/bots')) as RawBot[];
    const rows = [];
    for (const b of bots) {
      let messages_total = 0;
      let leads_total = 0;
      try {
        const m = (await engineFetch(`/bots/${b.bot_id}/metrics`)) as { messages_total?: number; leads_total?: number };
        messages_total = m.messages_total ?? 0;
        leads_total = m.leads_total ?? 0;
      } catch {
        // métriques indisponibles : bot conservé avec 0
      }
      rows.push({
        bot_id: b.bot_id, name: b.name, slug: b.slug ?? '', status: b.status,
        languages: b.languages ?? [], default_language: b.default_language ?? '',
        numbers: b.numbers ?? [], messages_total, leads_total,
      });
    }
    return NextResponse.json(rows);
  } catch (err) {
    return errorResponse(err);
  }
}
