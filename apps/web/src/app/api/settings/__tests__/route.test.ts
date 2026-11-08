import { test, expect, vi, beforeEach } from 'vitest';

const engineFetch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/engine-fetch', () => ({ engineFetch }));
beforeEach(() => { engineFetch.mockReset(); engineFetch.mockResolvedValue({ visibility: 'all', pool_self_claim: true }); });

import { GET } from '../route';

test('GET /api/settings relaie les réglages de l\'organisation', async () => {
  const res = await GET();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ visibility: 'all', pool_self_claim: true });
  expect(engineFetch).toHaveBeenCalledWith('/settings', { method: 'GET' });
});
