import type { BotNumberSummary } from '@wabagent/contracts';
import type { BotView } from '@/lib/agent-types';

export function botNumber(over: { is_test?: boolean; present?: boolean; account_state?: BotNumberSummary['account']['state'] } = {}): BotNumberSummary {
  return {
    id: 4,
    phone_e164: '+33612000047',
    display_name: 'Boutique',
    is_test: over.is_test ?? false,
    provider_state: over.present === false ? 'removed' : 'present',
    quality: 'GREEN',
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
