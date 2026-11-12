import { describe, expect, it } from 'vitest';
import {
  LoginInput, AcceptInviteInput, ResetPasswordInput,
  CreateClientInput, CreateInvitationInput,
  CreateBotInput, PersonalityInput, SetBotStatusInput, AssignNumberInput, UnassignNumberInput, SetAllowlistInput, ActivateBotInput, VERIFICATION_CHECK_KEYS,
} from '../index.js';

describe('contracts: auth', () => {
  it('LoginInput valide + normalise l\'email', () => {
    const r = LoginInput.parse({ email: '  Admin@Flow.TEST ', password: 'longenough1' });
    expect(r.email).toBe('admin@flow.test');
  });

  it('LoginInput rejette un email invalide', () => {
    expect(() => LoginInput.parse({ email: 'nope', password: 'longenough1' })).toThrow();
  });

  it('AcceptInviteInput exige un mot de passe >= 10', () => {
    expect(() => AcceptInviteInput.parse({ token: 't', password: 'short' })).toThrow();
    expect(AcceptInviteInput.parse({ token: 't', password: 'longenough1' }).token).toBe('t');
  });

  it('ResetPasswordInput exige token + password', () => {
    expect(ResetPasswordInput.parse({ token: 't', password: 'longenough1' }).password).toBe('longenough1');
  });
});

describe('contracts: clients & invitations', () => {
  it('CreateClientInput exige client_id, name et first_entity_name', () => {
    const r = CreateClientInput.parse({ client_id: 'acme', name: 'Acme', first_entity_name: ' Siège ' });
    expect(r.status).toBe('active'); // défaut
    expect(r.first_entity_name).toBe('Siège');
    expect(CreateClientInput.safeParse({ client_id: 'acme', name: 'Acme' }).success).toBe(false);
    expect(CreateClientInput.safeParse({ client_id: 'acme', name: 'Acme', first_entity_name: '  ' }).success).toBe(false);
  });

  it('CreateInvitationInput refuse l\'ancien format { email, role } et le rôle super_admin', () => {
    expect(() => CreateInvitationInput.parse({ email: 'x@y.test', role: 'client_admin' })).toThrow();
    expect(() => CreateInvitationInput.parse({ email: 'x@y.test', grants: [{ entity_id: null, role: 'super_admin' }] })).toThrow();
  });
});

describe('contracts: bots', () => {
  it('CreateBotInput valide un bot minimal', () => {
    const r = CreateBotInput.parse({
      bot_id: 'sales', name: 'Ventes',
      system_prompt: { fr: 'Tu es un agent.' }, lead_fields: 'nom,email',
      welcome: { enabled: true, message: { fr: 'Bonjour' } },
    });
    expect(r.bot_id).toBe('sales');
  });
  it('CreateBotInput rejette un bot_id invalide', () => {
    expect(() => CreateBotInput.parse({ bot_id: 'Ventes Bot', name: 'x', system_prompt: { fr: 'a' }, lead_fields: '', welcome: { enabled: false, message: {} } })).toThrow();
  });
  it("CreateBotInput n'a plus de transport : le transport découle du compte du numéro", () => {
    const r = CreateBotInput.parse({ bot_id: 'sales', name: 'x', transport: 'sms', system_prompt: { fr: 'a' }, lead_fields: '', welcome: { enabled: false, message: {} } });
    expect(r).not.toHaveProperty('transport');
  });
  it('SetBotStatusInput : quatre statuts', () => {
    expect(() => SetBotStatusInput.parse({ status: 'live' })).toThrow();
    for (const status of ['draft', 'limited', 'active', 'paused']) expect(SetBotStatusInput.parse({ status }).status).toBe(status);
  });
  it('AssignNumberInput : entier positif', () => {
    expect(AssignNumberInput.parse({ number_id: 3, expected_bot_id: null }).number_id).toBe(3);
    expect(() => AssignNumberInput.parse({ number_id: 0, expected_bot_id: null })).toThrow();
    expect(() => AssignNumberInput.parse({ number_id: 1.5, expected_bot_id: null })).toThrow();
    expect(() => AssignNumberInput.parse({ number_id: '3', expected_bot_id: null })).toThrow();
  });
  // revue 2b-3 M-1 : le détenteur vu par l'écran est obligatoire (null : numéro libre)
  it('AssignNumberInput et ActivateBotInput : expected_bot_id obligatoire, chaîne ou null', () => {
    expect(AssignNumberInput.parse({ number_id: 3, expected_bot_id: 'ventes' }).expected_bot_id).toBe('ventes');
    expect(() => AssignNumberInput.parse({ number_id: 3 })).toThrow();
    expect(() => AssignNumberInput.parse({ number_id: 3, expected_bot_id: '' })).toThrow();
    expect(() => AssignNumberInput.parse({ number_id: 3, expected_bot_id: 7 })).toThrow();
    expect(ActivateBotInput.parse({ number_id: 1, expected_bot_id: null, status: 'limited' }).expected_bot_id).toBeNull();
    expect(() => ActivateBotInput.parse({ number_id: 1, status: 'limited' })).toThrow();
  });
  // revue finale 2b-3 I-2 : le numéro que l'écran affichait est obligatoire pour débrancher
  it('UnassignNumberInput : expected_number_id entier positif obligatoire', () => {
    expect(UnassignNumberInput.parse({ expected_number_id: 3 }).expected_number_id).toBe(3);
    expect(() => UnassignNumberInput.parse({})).toThrow();
    expect(() => UnassignNumberInput.parse({ expected_number_id: null })).toThrow();
    expect(() => UnassignNumberInput.parse({ expected_number_id: 0 })).toThrow();
    expect(() => UnassignNumberInput.parse({ expected_number_id: '3' })).toThrow();
  });
  it('SetAllowlistInput et ActivateBotInput : 20 entrées au plus', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `+3361234560${String(i).padStart(2, '0')}`);
    expect(SetAllowlistInput.parse({ entries: twenty }).entries).toHaveLength(20);
    expect(() => SetAllowlistInput.parse({ entries: [...twenty, '+33600000000'] })).toThrow();
    expect(ActivateBotInput.parse({ number_id: 1, expected_bot_id: null, status: 'limited', allowlist: twenty }).allowlist).toHaveLength(20);
    expect(() => ActivateBotInput.parse({ number_id: 1, expected_bot_id: null, status: 'limited', allowlist: [...twenty, '+33600000000'] })).toThrow();
    expect(() => ActivateBotInput.parse({ number_id: 1, expected_bot_id: null, status: 'paused', allowlist: [] })).toThrow();
    expect(ActivateBotInput.parse({ number_id: 1, expected_bot_id: null, status: 'active' }).allowlist).toEqual([]);
    const long = `FR.${'a'.repeat(61)}`;
    expect(SetAllowlistInput.parse({ entries: [long] }).entries).toEqual([long]);
    expect(() => SetAllowlistInput.parse({ entries: [`${long}b`] })).toThrow();
    expect(() => ActivateBotInput.parse({ number_id: 1, expected_bot_id: null, status: 'limited', allowlist: [`${long}b`] })).toThrow();
  });
});

describe('contracts: bots personality', () => {
  it('PersonalityInput exige un role, defaults sur le reste', () => {
    const p = PersonalityInput.parse({ role: 'Conseiller' });
    expect(p).toEqual({ role: 'Conseiller', tones: [], objective: '', info: '' });
    expect(() => PersonalityInput.parse({ role: '' })).toThrow();
  });

  it('CreateBotInput accepte personality et rend system_prompt optionnel', () => {
    const b = CreateBotInput.parse({
      bot_id: 'sales', name: 'Ventes',
      welcome: { enabled: false, message: {} },
      personality: { fr: { role: 'Conseiller' } },
    });
    expect(b.system_prompt).toEqual({});
    expect(b.personality?.fr.role).toBe('Conseiller');
  });

  it('CreateBotInput sans personality => personality null', () => {
    const b = CreateBotInput.parse({
      bot_id: 'sales', name: 'Ventes',
      system_prompt: { fr: 'Agent.' }, welcome: { enabled: false, message: {} },
    });
    expect(b.personality).toBeNull();
  });
});

// revue finale 2b-3 m-12 : source unique des contrôles de vérification
describe('contracts: contrôles de vérification', () => {
  it('VERIFICATION_CHECK_KEYS : les neuf contrôles, sans doublon', () => {
    expect([...VERIFICATION_CHECK_KEYS]).toEqual(['token', 'waba_access', 'app_secret', 'subscription', 'token_expiry', 'numbers', 'cm_account', 'cm_channels', 'app']);
    expect(new Set(VERIFICATION_CHECK_KEYS).size).toBe(VERIFICATION_CHECK_KEYS.length);
  });
});
