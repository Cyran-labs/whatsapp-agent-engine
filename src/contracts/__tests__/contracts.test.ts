import { describe, expect, it } from 'vitest';
import {
  LoginInput, AcceptInviteInput, ResetPasswordInput,
  CreateClientInput, CreateInvitationInput,
  CreateBotInput, SetNumbersInput, SetBotStatusInput,
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
  it('CreateClientInput exige client_id + name', () => {
    const r = CreateClientInput.parse({ client_id: 'acme', name: 'Acme' });
    expect(r.status).toBe('active'); // défaut
  });

  it('CreateInvitationInput valide role enum', () => {
    expect(() => CreateInvitationInput.parse({ email: 'x@y.test', role: 'root' })).toThrow();
    const r = CreateInvitationInput.parse({ email: '  X@Y.test ', role: 'client_admin' });
    expect(r.email).toBe('x@y.test');
  });
});

describe('contracts: bots', () => {
  it('CreateBotInput valide un bot minimal', () => {
    const r = CreateBotInput.parse({
      bot_id: 'sales', name: 'Ventes', transport: 'meta-cloud',
      system_prompt: { fr: 'Tu es un agent.' }, lead_fields: 'nom,email',
      welcome: { enabled: true, message: { fr: 'Bonjour' } },
    });
    expect(r.bot_id).toBe('sales');
  });
  it('CreateBotInput rejette un bot_id invalide', () => {
    expect(() => CreateBotInput.parse({ bot_id: 'Ventes Bot', name: 'x', transport: 'meta-cloud', system_prompt: { fr: 'a' }, lead_fields: '', welcome: { enabled: false, message: {} } })).toThrow();
  });
  it('CreateBotInput rejette un transport inconnu', () => {
    expect(() => CreateBotInput.parse({ bot_id: 'sales', name: 'x', transport: 'sms', system_prompt: { fr: 'a' }, lead_fields: '', welcome: { enabled: false, message: {} } })).toThrow();
  });
  it('SetNumbersInput + SetBotStatusInput', () => {
    expect(SetNumbersInput.parse({ numbers: ['+33611', '33622'] }).numbers).toHaveLength(2);
    expect(() => SetBotStatusInput.parse({ status: 'live' })).toThrow();
    expect(SetBotStatusInput.parse({ status: 'active' }).status).toBe('active');
  });
});
