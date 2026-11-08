import { NextResponse } from 'next/server';
import { engineFetch } from '@/lib/engine-fetch';
import { errorResponse } from '@/lib/api-response';

interface RawBot { bot_id: string; name: string; slug?: string; status: string; languages?: string[]; default_language?: string; numbers?: string[]; system_prompt?: Record<string, string>; entity_id: number }

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
      const defaultLang = b.default_language ?? '';
      const personalized = !!(b.system_prompt?.[defaultLang]?.trim());
      rows.push({
        bot_id: b.bot_id, name: b.name, slug: b.slug ?? '', status: b.status,
        languages: b.languages ?? [], default_language: defaultLang,
        numbers: b.numbers ?? [], messages_total, leads_total, personalized,
        entity_id: b.entity_id,
      });
    }
    return NextResponse.json(rows);
  } catch (err) {
    return errorResponse(err);
  }
}
