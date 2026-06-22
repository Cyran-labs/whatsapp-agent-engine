import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
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
  it('bloque au-delà du max dans la fenêtre', async () => {
    const a = app();
    expect((await request(a).get('/p')).status).toBe(200);
    expect((await request(a).get('/p')).status).toBe(200);
    const third = await request(a).get('/p');
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMITED');
  });
});
