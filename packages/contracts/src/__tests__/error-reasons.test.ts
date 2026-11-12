import { describe, expect, it } from 'vitest';
import { ERROR_REASONS, TRANSITION_MESSAGES } from '../index.js';

describe('contracts: clés de refus (error.reason)', () => {
  it('sans doublon, chaque clé de la forme <domaine>.<cas> en snake_case', () => {
    expect(new Set(ERROR_REASONS).size).toBe(ERROR_REASONS.length);
    for (const key of ERROR_REASONS) expect(key).toMatch(/^[a-z_]+\.[a-z_]+$/);
  });

  // audit R-15
  it('chaque refus de la machine d\'états a sa clé transition.<refus>', () => {
    for (const refusal of Object.keys(TRANSITION_MESSAGES)) {
      expect(ERROR_REASONS).toContain(`transition.${refusal}`);
    }
  });

  it('les clés imposées par le lot existent', () => {
    for (const key of [
      'assign.holder_changed', 'assign.number_removed', 'whatsapp_account.already_connected',
      'whatsapp_account.cannot_connect', 'whatsapp_account.in_use', 'whatsapp_account.disconnected',
      'entity.duplicate_name', 'entity.last_active', 'entity.in_use', 'member.last_admin', 'member.already_member',
      'invitation.not_invitable', 'invitation.already_accepted', 'invitation.not_found',
      'bot.default_language_missing', 'bot.entity_required',
      // audit décisions B7 : la lecture des numéros dit sa cause
      'whatsapp_account.listing_token_invalid', 'whatsapp_account.listing_unavailable', 'whatsapp_account.listing_failed',
      // audit décisions B2
      'entity.name_invalid',
    ]) expect(ERROR_REASONS).toContain(key);
  });

  it('ERROR_REASONS contient les cinq raisons R1', () => {
    for (const key of [
      'whatsapp_account.public_url_missing', 'whatsapp_account.webhook_unreachable',
      'whatsapp_account.webhook_unconfirmed', 'whatsapp_account.webhook_url_too_long',
      'whatsapp_account.app_webhook_failed',
      // Audit des décisions R1 N-5 (A-7) : panne passagère de Meta pendant l'inscription
      'whatsapp_account.meta_unavailable',
    ]) expect(ERROR_REASONS).toContain(key);
  });

  it('les domaines sont ceux du lot', () => {
    const domains = new Set(ERROR_REASONS.map((k) => k.split('.')[0]));
    expect([...domains].sort()).toEqual([
      'allowlist', 'assign', 'auth', 'bot', 'entity', 'invitation', 'member', 'session', 'transition', 'whatsapp_account',
    ]);
  });
});
