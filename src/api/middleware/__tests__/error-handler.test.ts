import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { errorHandler } from '../error-handler.js';

function fakeRes() {
  return { statusCode: 0, body: undefined as unknown, status(code: number) { this.statusCode = code; return this; }, json(b: unknown) { this.body = b; return this; } };
}

describe('errorHandler', () => {
  afterEach(() => vi.restoreAllMocks());

  // revue finale 2b-3 I-1
  it("revue finale 2b-3 I-1 : erreur inconnue : 500, journal limité au nom et à la pile, jamais l'objet entier (champ body compris)", () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const err = Object.assign(new Error('boom'), { body: '{"token":"SECRET-DANS-LE-CORPS"}', headers: { authorization: 'Bearer SECRET-ENTETE' } });
    const res = fakeRes();
    errorHandler(err, { requestId: 'r-1' } as Request, res as unknown as Response, () => undefined);
    expect(res.statusCode).toBe(500);
    expect(spy).toHaveBeenCalledTimes(1);
    for (const arg of spy.mock.calls[0]!) expect(typeof arg).toBe('string');
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain('Error');
    expect(logged).not.toContain('SECRET');
  });

  // revue finale 2b-3 I-1
  it("revue finale 2b-3 I-1 : valeur levée qui n'est pas une erreur : 500, rien d'autre que son type n'est journalisé", () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = fakeRes();
    errorHandler({ body: 'SECRET-OBJET' }, { requestId: 'r-2' } as Request, res as unknown as Response, () => undefined);
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(spy.mock.calls)).not.toContain('SECRET');
  });
  // revue 2b-3 (mineur) : seuls les types de body-parser donnent un 400 ; un `type` quelconque d'une autre bibliothèque reste un 500
  it("un `type` qui n'est pas de body-parser : 500 et non 400", () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = fakeRes();
    errorHandler(Object.assign(new Error('x'), { type: 'autre' }), { requestId: 'r-3' } as Request, res as unknown as Response, () => undefined);
    expect(res.statusCode).toBe(500);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it.each(['entity.too.large', 'entity.parse.failed', 'encoding.unsupported', 'charset.unsupported', 'request.aborted', 'request.size.invalid', 'stream.encoding.set', 'stream.not.readable'])(
    'type body-parser %s : 400 VALIDATION_ERROR',
    (type) => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const res = fakeRes();
      errorHandler(Object.assign(new Error('x'), { type }), { requestId: 'r-4' } as Request, res as unknown as Response, () => undefined);
      expect(res.statusCode).toBe(400);
    },
  );
});
