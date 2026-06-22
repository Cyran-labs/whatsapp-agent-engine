import { describe, expect, it } from 'vitest';
import {
  LoginInput, AcceptInviteInput, ResetPasswordInput,
  CreateClientInput, CreateInvitationInput,
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
