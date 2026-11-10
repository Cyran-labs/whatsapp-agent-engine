import { NextResponse } from 'next/server';
import { engineFetch } from '@/lib/engine-fetch';
import { errorResponse } from '@/lib/api-response';
import { jsonResponse } from '@/lib/api-json';
import type { NotRespondingReason } from '@wabagent/contracts';
import { isNumberConnected, type AgentSummaryRow, type NumberConnection } from '@/lib/onboarding';

interface RawBot { bot_id: string; name: string; slug?: string; status: string; status_reason?: string | null; not_responding?: NotRespondingReason | null; languages?: string[]; default_language?: string; whatsapp_number?: (NumberConnection & { phone_e164: string }) | null; system_prompt?: Record<string, string>; entity_id: number }

export async function GET(): Promise<NextResponse> {
  try {
    const bots = (await engineFetch('/bots')) as RawBot[];
    const rows: AgentSummaryRow[] = [];
    for (const b of bots) {
      // Compteurs inconnus : null, jamais 0 (un agent IA dont la lecture a échoué reste dans la liste).
      let messages_total: number | null = null;
      let leads_total: number | null = null;
      try {
        const m = (await engineFetch(`/bots/${encodeURIComponent(b.bot_id)}/metrics`)) as { messages_total?: number; leads_total?: number };
        messages_total = m.messages_total ?? null;
        leads_total = m.leads_total ?? null;
      } catch {
        // métriques indisponibles : agent IA conservé, compteurs inconnus
      }
      const defaultLang = b.default_language ?? '';
      const personalized = !!(b.system_prompt?.[defaultLang]?.trim());
      rows.push({
        bot_id: b.bot_id, name: b.name, slug: b.slug ?? '', status: b.status,
        // Motif de pause et mention « Ne répond pas » calculés par le moteur, relayés tels quels (spec navigation §7.2).
        status_reason: b.status_reason ?? null, not_responding: b.not_responding ?? null,
        account_state: b.whatsapp_number?.account.state ?? null,
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
