import { describe, expect, it } from 'vitest';
import { AppError, toErrorBody, unauthorized, forbidden, notFound, conflict, validationError } from '../errors.js';

describe('AppError / toErrorBody', () => {
  it('unauthorized → 401 code UNAUTHORIZED', () => {
    const e = unauthorized('nope');
    expect(e).toBeInstanceOf(AppError);
    expect(e.status).toBe(401);
    expect(e.code).toBe('UNAUTHORIZED');
  });

  it('conflict → 409 CONFLICT', () => {
    expect(conflict('taken').status).toBe(409);
    expect(conflict('taken').code).toBe('CONFLICT');
  });

  it('toErrorBody enveloppe code/message/details/request_id', () => {
    const body = toErrorBody(validationError([{ path: 'email', message: 'invalid' }]), 'req-1');
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toEqual([{ path: 'email', message: 'invalid' }]);
    expect(body.error.request_id).toBe('req-1');
  });

  it('toErrorBody écrit reason quand il est présent, et seulement alors', () => {
    expect(toErrorBody(conflict('taken', 'entity.duplicate_name'), 'req-1').error.reason).toBe('entity.duplicate_name');
    expect('reason' in toErrorBody(conflict('taken'), 'req-1').error).toBe(false);
  });

  it('chaque fabrique et le constructeur portent la clé', () => {
    expect(new AppError('CONFLICT', 'm', undefined, 'member.last_admin').reason).toBe('member.last_admin');
    expect(unauthorized('m', 'session.expired').reason).toBe('session.expired');
    expect(forbidden('m', 'session.organization_suspended').reason).toBe('session.organization_suspended');
    expect(notFound('m', 'entity.not_found').reason).toBe('entity.not_found');
    expect(validationError([], 'm', 'bot.entity_required').reason).toBe('bot.entity_required');
  });
});
