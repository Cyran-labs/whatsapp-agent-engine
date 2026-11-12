import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  matchPendingVerification, pendingVerificationKeysForTests, registerPendingVerification,
  resetPendingVerificationsForTests, PENDING_VERIFICATION_TTL_MS,
} from '../pending-verification.js';
import { hashWebhookKey } from '../../whatsapp/webhook-key.js';

const KEY = 'cle-en-attente';

describe('registre des vérifications Meta attendues', () => {
  beforeEach(() => { resetPendingVerificationsForTests(); });
  afterEach(() => { vi.useRealTimers(); resetPendingVerificationsForTests(); });

  it('le jeton enregistré pour la clé est reconnu, pas un autre jeton ni une autre clé', () => {
    registerPendingVerification(KEY, 'jeton-a');
    expect(matchPendingVerification(KEY, 'jeton-a')).toBe(true);
    expect(matchPendingVerification(KEY, 'jeton-b')).toBe(false);
    expect(matchPendingVerification(KEY, '')).toBe(false);
    expect(matchPendingVerification('autre-cle', 'jeton-a')).toBe(false);
  });

  it('après libération : plus reconnu, et la libération est idempotente', () => {
    const release = registerPendingVerification(KEY, 'jeton-a');
    release();
    release();
    expect(matchPendingVerification(KEY, 'jeton-a')).toBe(false);
    expect(pendingVerificationKeysForTests()).toEqual([]);
  });

  it('expire seul après le délai (60 s par défaut)', () => {
    vi.useFakeTimers();
    registerPendingVerification(KEY, 'jeton-a');
    vi.advanceTimersByTime(PENDING_VERIFICATION_TTL_MS - 1);
    expect(matchPendingVerification(KEY, 'jeton-a')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(matchPendingVerification(KEY, 'jeton-a')).toBe(false);
    expect(pendingVerificationKeysForTests()).toEqual([]);
  });

  it('délai personnalisé', () => {
    vi.useFakeTimers();
    registerPendingVerification(KEY, 'jeton-a', 1_000);
    vi.advanceTimersByTime(1_000);
    expect(matchPendingVerification(KEY, 'jeton-a')).toBe(false);
  });

  it("la libération d'un ancien enregistrement ne retire pas le nouveau de la même clé", () => {
    const first = registerPendingVerification(KEY, 'jeton-1');
    registerPendingVerification(KEY, 'jeton-2');
    first();
    expect(matchPendingVerification(KEY, 'jeton-2')).toBe(true);
    expect(matchPendingVerification(KEY, 'jeton-1')).toBe(false);
  });

  it("le registre ne garde que l'empreinte de la clé", () => {
    registerPendingVerification(KEY, 'jeton-a');
    const keys = pendingVerificationKeysForTests();
    expect(keys).toEqual([hashWebhookKey(KEY)]);
    expect(keys).not.toContain(KEY);
    expect(JSON.stringify(keys)).not.toContain(KEY);
  });
});
