import { NextResponse } from 'next/server';
import { engineFetch } from '@/lib/engine-fetch';
import { errorResponse } from '@/lib/api-response';
import { jsonResponse } from '@/lib/api-json';
import { isNumberConnected, type NumberConnection } from '@/lib/onboarding';

interface RawBot { bot_id: string; name: string; slug?: string; status: string; languages?: string[]; default_language?: string; whatsapp_number?: (NumberConnection & { phone_e164: string }) | null; system_prompt?: Record<string, string>; entity_id: number }

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
        // Le moteur porte au plus un numéro branché par agent IA (`whatsapp_number`).
        number: b.whatsapp_number?.phone_e164 ?? null, connected: isNumberConnected(b.whatsapp_number ?? null), messages_total, leads_total, personalized,
        entity_id: b.entity_id,
      });
    }
    return jsonResponse(rows);
  } catch (err) {
    return errorResponse(err);
  }
}
