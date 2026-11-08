import { describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { serve } from '../http.js';

const hello: http.RequestListener = (_req, res) => { res.end('ok'); };
let previous: http.Server | undefined;

describe('serve', () => {
  it('écoute sur 127.0.0.1 en IPv4, jamais sur le joker ::', async () => {
    const server = await serve(hello);
    const addr = server.address() as AddressInfo;
    expect(addr.address).toBe('127.0.0.1');
    expect(addr.family).toBe('IPv4');
    expect((await request(server).get('/')).text).toBe('ok');
    previous = server;
  });

  it('même application dans un test : même serveur, y compris en appels simultanés', async () => {
    const [a, b] = await Promise.all([serve(hello), serve(hello)]);
    expect(a).toBe(b);
    expect(await serve(hello)).toBe(a);
  });

  it('le serveur du test précédent est fermé ; un nouveau est créé', async () => {
    expect(previous?.listening).toBe(false);
    const server = await serve(hello);
    expect(server).not.toBe(previous);
    expect(server.listening).toBe(true);
  });
});
