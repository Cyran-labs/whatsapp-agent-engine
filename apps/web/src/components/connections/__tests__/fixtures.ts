import type { WhatsAppAccountView, WhatsAppNumberView } from '@wabagent/contracts';

export function numberView(over: Partial<WhatsAppNumberView> = {}): WhatsAppNumberView {
  return {
    id: 1,
    phone_e164: '+33612457890',
    display_name: 'Boutique Marais',
    meta_status: 'CONNECTED',
    quality: 'GREEN',
    is_test: false,
    provider_state: 'present',
    removed_at: null,
    delivery_failures: 0,
    last_delivery_error_code: null,
    bot: null,
    ...over,
  };
}

export function accountView(over: Partial<WhatsAppAccountView> = {}): WhatsAppAccountView {
  return {
    id: 1,
    name: 'Boutique principale',
    mode: 'meta_manual',
    provider_account_id: '104829371625544',
    waba_id: '104829371625544',
    state: 'connected',
    error_reason: null,
    last_verified_at: null,
    token_expiry: 'never',
    secret_checked_at: null,
    is_test: false,
    alerts: [],
    webhook: {
      path: '/webhook/meta/cle-secrete-du-compte',
      url: 'https://dev.wabagent.com/webhook/meta/cle-secrete-du-compte',
      verify_token: 'wab_vt_8Kq2abcdefghijx7Pa',
    },
    numbers: [numberView()],
    ...over,
  };
}
