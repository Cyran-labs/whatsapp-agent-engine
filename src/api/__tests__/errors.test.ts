import { describe, expect, it } from 'vitest';
import { AppError, toErrorBody, unauthorized, conflict, validationError } from '../errors.js';

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
});
