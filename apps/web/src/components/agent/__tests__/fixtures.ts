import type { BotNumberSummary } from '@wabagent/contracts';
import type { BotView } from '@/lib/agent-types';

export function botNumber(over: { is_test?: boolean; present?: boolean; account_state?: BotNumberSummary['account']['state']; delivery_failures?: number; last_delivery_error_code?: number | null } = {}): BotNumberSummary {
  return {
    id: 4,
    phone_e164: '+33612000047',
    display_name: 'Boutique',
    is_test: over.is_test ?? false,
    provider_state: over.present === false ? 'removed' : 'present',
    quality: 'GREEN',
    delivery_failures: over.delivery_failures ?? 0,
    last_delivery_error_code: over.last_delivery_error_code ?? null,
    account: { id: 1, name: 'Compte principal', mode: 'meta_manual', state: over.account_state ?? 'connected', error_reason: null },
  };
}

export function botView(over: Partial<BotView> = {}): BotView {
  return {
    bot_id: 'b1',
    name: 'Conseil Marais',
    status: 'limited',
    status_reason: null,
    entity_id: 1,
    whatsapp_number: botNumber(),
    allowlist: ['+33611111111', '+33622222222'],
    unserved: { count: 0, last_at: null },
    ...over,
  };
}
