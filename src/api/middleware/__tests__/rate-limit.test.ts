import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Request, Response, NextFunction } from 'express';
import { createRateLimiter } from '../rate-limit.js';
import { requestId } from '../context.js';
import { errorHandler } from '../error-handler.js';

function app() {
  const a = express();
  a.use(requestId);
  a.get('/p', createRateLimiter({ windowMs: 60_000, max: 2 }), (_req, res) => res.json({ ok: true }));
  a.use(errorHandler);
  return a;
}

describe('rate limiter', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('bloque au-delà du max dans la fenêtre', async () => {
    const a = app();
    expect((await request(a).get('/p')).status).toBe(200);
    expect((await request(a).get('/p')).status).toBe(200);
    const third = await request(a).get('/p');
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMITED');
  });

  it('réautorise après la fenêtre écoulée', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const mw = createRateLimiter({ windowMs: 1000, max: 2 });
    const call = (ip: string): boolean => {
      let blocked = false;
      mw(
        { ip, path: '/p' } as unknown as Request,
        {} as Response,
        ((err?: unknown) => { if (err) blocked = true; }) as NextFunction
      );
      return blocked;
    };
    expect(call('1.1.1.1')).toBe(false);
    expect(call('1.1.1.1')).toBe(false);
    expect(call('1.1.1.1')).toBe(true); // 3e bloqué dans la fenêtre
    vi.advanceTimersByTime(1001); // fenêtre écoulée -> purge + reset
    expect(call('1.1.1.1')).toBe(false); // de nouveau autorisé
  });
});
