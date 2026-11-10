import type { WhatsAppAccountView, WhatsAppNumberView, WhatsAppWebhookView } from '@wabagent/contracts';

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
    meta_app_id: '1424483510748297',
    state: 'connected',
    error_reason: null,
    error_detail: null,
    error_cause: null,
    provider_text: null,
    last_verified_at: null,
    token_expiry: 'never',
    secret_checked_at: null,
    is_test: false,
    alerts: [],
    numbers: [numberView()],
    ...over,
  };
}

/** Webhook d'un compte Meta tel que `GET /api/whatsapp-accounts/:id/webhook` le renvoie. */
export function webhookView(over: Partial<WhatsAppWebhookView> = {}): WhatsAppWebhookView {
  return {
    path: '/webhook/meta/cle-secrete-du-compte',
    url: 'https://dev.wabagent.com/webhook/meta/cle-secrete-du-compte',
    verify_token: 'wab_vt_8Kq2abcdefghijx7Pa',
    ...over,
  };
}
