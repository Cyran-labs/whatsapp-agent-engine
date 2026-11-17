// Client Graph du profil WhatsApp, de la photo, du nom d'affichage et du portefeuille (lot R2a, tâche 3).
// Le faux Meta rejoue les formes observées en réel le 17 nov. 2026
// (docs/superpowers/research/2026-11-17-essai-r2a-profil-nom.md, §1, §3, §4 et §5).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appSecretProof, makeContext } from '../meta-graph.js';
import type { MetaManualCredentials } from '../meta-graph.js';
import {
  readBusinessProfile, readOwnerBusiness, registerNumber, requestDisplayName, setProfilePhoto, uploadProfilePhoto,
  writeBusinessProfile,
} from '../meta-profile.js';

const creds: MetaManualCredentials = {
  waba_id: '1122051030798254',
  access_token: 'EAAGsecretTOKENvalue1234567890',
  app_secret: 'appsecretvalueabcdef',
};
const PROOF = appSecretProof(creds.access_token, creds.app_secret);
const PN = '1444139162121271';
const APP_ID = '2202427980234937';
const PIN = '482915';
const SESSION = 'upload:MTphdHRhY2htZW50OjEyMzQ1Njc4OTA=?sig=ARZsigValue0123';

interface Call { method: string; url: URL; headers: Record<string, string>; body: unknown; raw: string }

type Responder = (call: Call) => Response | undefined;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function metaError(status: number, error: Record<string, unknown>): Response {
  return json(status, { error: { type: 'OAuthException', fbtrace_id: 'trace', ...error } });
}

/** Faux Meta : `respond` répond en premier, sinon les réponses de réussite observées à l'essai. */
function graph(respond: Responder = () => undefined): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => { headers[k] = v; });
    const rawBody = init?.body;
    let raw = '';
    let body: unknown = null;
    if (typeof rawBody === 'string') {
      raw = rawBody;
      try { body = JSON.parse(rawBody); } catch { body = rawBody; }
    } else if (rawBody instanceof Uint8Array) {
      raw = Buffer.from(rawBody).toString('latin1');
      body = rawBody;
    }
    const call: Call = { method: init?.method ?? 'GET', url, headers, body, raw };
    calls.push(call);
    const custom = respond(call);
    if (custom !== undefined) return custom;
    const path = url.pathname;
    if (path === `/v26.0/${creds.waba_id}`) return json(200, { owner_business_info: { name: 'Wabagent', id: '1270659448489249' }, id: creds.waba_id });
    if (path === `/v26.0/${PN}/whatsapp_business_profile` && call.method === 'GET') {
      return json(200, { data: [{
        about: 'Bonjour', address: '1 rue de la Paix', description: 'Boutique', email: 'contact@example.com',
        profile_picture_url: 'https://pps.whatsapp.net/v/photo.jpg', websites: ['https://example.com/'], vertical: 'RETAIL',
        messaging_product: 'whatsapp',
      }] });
    }
    if (path === `/v26.0/${APP_ID}/uploads`) return json(200, { id: SESSION });
    if (path.startsWith('/v26.0/upload:')) return json(200, { h: '4::aW1hZ2UvanBlZw==:handle' });
    return json(200, { success: true });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function ctxOf(g: { fetchImpl: typeof fetch }) {
  return makeContext(creds, { fetchImpl: g.fetchImpl });
}

function expectAccountAuth(call: Call | undefined, path: string): void {
  expect(call).toBeDefined();
  expect(call?.url.origin).toBe('https://graph.facebook.com');
  expect(call?.url.pathname).toBe(path);
  expect(call?.headers['authorization']).toBe(`Bearer ${creds.access_token}`);
  expect(call?.url.searchParams.get('appsecret_proof')).toBe(PROOF);
  // Le jeton ne part jamais dans l'adresse.
  expect(call?.url.href).not.toContain(creds.access_token);
}

afterEach(() => { vi.restoreAllMocks(); });

describe('readOwnerBusiness (spec R2a §4, §5.1)', () => {
  it('lit owner_business_info sur la WABA avec le jeton du compte et appsecret_proof', async () => {
    const g = graph();
    const r = await readOwnerBusiness(ctxOf(g), creds.waba_id);
    expect(r).toEqual({ ok: true, business: { id: '1270659448489249', name: 'Wabagent' } });
    expect(g.calls).toHaveLength(1);
    expect(g.calls[0].method).toBe('GET');
    expectAccountAuth(g.calls[0], `/v26.0/${creds.waba_id}`);
    expect(g.calls[0].url.searchParams.get('fields')).toBe('owner_business_info');
  });

  it('identifiant numérique recopié en texte', async () => {
    const g = graph(() => json(200, { owner_business_info: { name: 'Wabagent', id: 1270659448489249 } }));
    expect(await readOwnerBusiness(ctxOf(g), creds.waba_id)).toEqual({ ok: true, business: { id: '1270659448489249', name: 'Wabagent' } });
  });

  it('owner_business_info absent ou incomplet : échec, jamais un portefeuille inventé', async () => {
    for (const body of [
      { id: creds.waba_id }, { owner_business_info: { name: 'Wabagent' } }, { owner_business_info: { id: '1' } },
      { owner_business_info: { name: 'Wabagent', id: 'abc' } },
    ]) {
      const r = await readOwnerBusiness(ctxOf(graph(() => json(200, body))), creds.waba_id);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.failure.kind).toBe('other');
    }
  });

  it('jeton refusé : token_invalid ; réponse 5xx : transitoire', async () => {
    const refused = await readOwnerBusiness(ctxOf(graph(() => metaError(401, { code: 190, message: 'Invalid OAuth access token' }))), creds.waba_id);
    expect(!refused.ok && refused.failure).toEqual({ kind: 'token_invalid' });
    const down = await readOwnerBusiness(ctxOf(graph(() => metaError(503, { code: 2, message: 'Service temporarily unavailable' }))), creds.waba_id);
    expect(!down.ok && down.failure).toMatchObject({ kind: 'other', transient: true });
  });
});

describe('readBusinessProfile (spec R2a §6.1, essai §5)', () => {
  it('lit le profil du numéro avec le jeton du compte, sur son provider_number_id', async () => {
    const g = graph();
    const now = new Date('2026-11-17T10:00:00.000Z');
    const r = await readBusinessProfile(ctxOf(g), PN, now);
    expect(r).toEqual({ ok: true, profile: {
      about: 'Bonjour', description: 'Boutique', address: '1 rue de la Paix', email: 'contact@example.com',
      websites: ['https://example.com/'], vertical: 'RETAIL', photo_url: 'https://pps.whatsapp.net/v/photo.jpg',
      read_at: '2026-11-17T10:00:00.000Z',
    } });
    expect(g.calls).toHaveLength(1);
    expect(g.calls[0].method).toBe('GET');
    expectAccountAuth(g.calls[0], `/v26.0/${PN}/whatsapp_business_profile`);
    expect((g.calls[0].url.searchParams.get('fields') ?? '').split(',')).toEqual(expect.arrayContaining([
      'about', 'address', 'description', 'email', 'profile_picture_url', 'websites', 'vertical',
    ]));
  });

  it('champs absents : textes vides, aucun site, aucune photo', async () => {
    const g = graph(() => json(200, { data: [{ messaging_product: 'whatsapp' }] }));
    const r = await readBusinessProfile(ctxOf(g), PN);
    expect(r.ok && r.profile).toMatchObject({ about: '', description: '', address: '', email: '', websites: [], vertical: '', photo_url: null });
  });

  it('sites d\'une autre forme écartés', async () => {
    const g = graph(() => json(200, { data: [{ websites: ['https://a.example/', 42, '', null] }] }));
    const r = await readBusinessProfile(ctxOf(g), PN);
    expect(r.ok && r.profile.websites).toEqual(['https://a.example/']);
  });

  it('adresse de photo autre que https : aucune photo', async () => {
    for (const url of ['javascript:alert(1)', 'http://pps.whatsapp.net/p.jpg', 'pas une adresse']) {
      const r = await readBusinessProfile(ctxOf(graph(() => json(200, { data: [{ profile_picture_url: url }] }))), PN);
      expect(r.ok && r.profile.photo_url).toBeNull();
    }
  });

  it('data vide ou illisible : échec', async () => {
    for (const body of [{ data: [] }, {}, { data: 'x' }]) {
      const r = await readBusinessProfile(ctxOf(graph(() => json(200, body))), PN);
      expect(r.ok).toBe(false);
    }
  });
});

describe('writeBusinessProfile (spec R2a §6.2, essai §5)', () => {
  it('Review Focus 2 : { address: \'\' } envoie address vide, avec messaging_product, et rien d\'autre', async () => {
    const g = graph();
    const r = await writeBusinessProfile(ctxOf(g), PN, { address: '' });
    expect(r).toEqual({ ok: true });
    expect(g.calls).toHaveLength(1);
    expect(g.calls[0].method).toBe('POST');
    expectAccountAuth(g.calls[0], `/v26.0/${PN}/whatsapp_business_profile`);
    expect(g.calls[0].headers['content-type']).toBe('application/json');
    expect(g.calls[0].body).toEqual({ messaging_product: 'whatsapp', address: '' });
  });

  it('seuls les champs présents partent ; websites vide envoyé vide', async () => {
    const g = graph();
    await writeBusinessProfile(ctxOf(g), PN, { about: 'Infos', websites: [], vertical: 'RETAIL' });
    expect(g.calls[0].body).toEqual({ messaging_product: 'whatsapp', about: 'Infos', websites: [], vertical: 'RETAIL' });
  });

  it('le contenu du profil ne part jamais dans l\'adresse', async () => {
    const g = graph();
    await writeBusinessProfile(ctxOf(g), PN, { address: '12 avenue Secrète', email: 'perso@example.com' });
    expect(g.calls[0].url.href).not.toContain('Secr');
    expect(g.calls[0].url.href).not.toContain('perso');
  });

  it('réponse sans success : échec, aucun champ désigné', async () => {
    const r = await writeBusinessProfile(ctxOf(graph(() => json(200, {}))), PN, { about: 'x' });
    expect(r).toMatchObject({ ok: false, field: null });
  });

  it('longueur refusée par Meta (code 100, « Param <champ> must be at most ») : le champ est désigné', async () => {
    const g = graph(() => metaError(400, { code: 100, message: 'Param address must be at most 256 characters long.' }));
    const r = await writeBusinessProfile(ctxOf(g), PN, { address: 'a'.repeat(300) });
    expect(r).toMatchObject({ ok: false, field: 'address' });
    expect(!r.ok && r.failure).toMatchObject({ kind: 'other', provider_text: 'Param address must be at most 256 characters long.' });
  });

  it('trop de sites (code 105) : websites désigné', async () => {
    const g = graph(() => metaError(400, { code: 105, message: 'The parameter websites must have at most 2 elements, 3 found.' }));
    const r = await writeBusinessProfile(ctxOf(g), PN, { websites: ['a', 'b', 'c'] });
    expect(r).toMatchObject({ ok: false, field: 'websites' });
  });

  it('erreur qui ne nomme aucun champ du profil : field null', async () => {
    const g = graph(() => metaError(400, { code: 100, message: 'Param messaging_product must be one of {whatsapp}' }));
    const r = await writeBusinessProfile(ctxOf(g), PN, { about: 'x' });
    expect(r).toMatchObject({ ok: false, field: null });
    const server = await writeBusinessProfile(ctxOf(graph(() => metaError(500, { code: 131000, message: 'Something went wrong' }))), PN, { about: 'x' });
    expect(server).toMatchObject({ ok: false, field: null, failure: { transient: true } });
  });
});

describe('uploadProfilePhoto (essai §4)', () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

  it('ouvre la session sur l\'app avec appsecret_proof, puis envoie le fichier en OAuth sans appsecret_proof', async () => {
    const g = graph();
    const r = await uploadProfilePhoto(ctxOf(g), APP_ID, { bytes, type: 'image/jpeg' });
    expect(r).toEqual({ ok: true, handle: '4::aW1hZ2UvanBlZw==:handle' });
    expect(g.calls).toHaveLength(2);

    const [open, send] = g.calls;
    expect(open.method).toBe('POST');
    expectAccountAuth(open, `/v26.0/${APP_ID}/uploads`);
    expect(open.url.searchParams.get('file_length')).toBe(String(bytes.length));
    expect(open.url.searchParams.get('file_type')).toBe('image/jpeg');

    expect(send.method).toBe('POST');
    expect(send.url.origin).toBe('https://graph.facebook.com');
    expect(send.url.pathname).toBe('/v26.0/upload:MTphdHRhY2htZW50OjEyMzQ1Njc4OTA=');
    expect(send.url.searchParams.get('sig')).toBe('ARZsigValue0123');
    // Piège de l'essai §4 : appsecret_proof ajouté à l'adresse de session casse le contrôle HMAC de Meta.
    expect(send.url.searchParams.has('appsecret_proof')).toBe(false);
    expect(send.headers['authorization']).toBe(`OAuth ${creds.access_token}`);
    expect(send.headers['file_offset']).toBe('0');
    expect(send.body).toBeInstanceOf(Uint8Array);
    expect(Array.from(send.body as Uint8Array)).toEqual(Array.from(bytes));
  });

  it('PNG : file_type image/png', async () => {
    const g = graph();
    await uploadProfilePhoto(ctxOf(g), APP_ID, { bytes, type: 'image/png' });
    expect(g.calls[0].url.searchParams.get('file_type')).toBe('image/png');
  });

  it('résolution trop faible (code 1, sous-code 3441013) : photoRejected', async () => {
    const g = graph((c) => c.url.pathname.startsWith('/v26.0/upload:')
      ? metaError(400, { code: 1, error_subcode: 3441013, message: 'Veuillez importer une image JPG dont la résolution est supérieure à 192 pixels * 192 pixels' })
      : undefined);
    const r = await uploadProfilePhoto(ctxOf(g), APP_ID, { bytes, type: 'image/jpeg' });
    expect(r).toMatchObject({ ok: false, photoRejected: true });
  });

  it('autre refus : photoRejected false', async () => {
    const g = graph((c) => c.url.pathname.endsWith('/uploads') ? metaError(400, { code: 100, message: 'Invalid parameter' }) : undefined);
    const r = await uploadProfilePhoto(ctxOf(g), APP_ID, { bytes, type: 'image/jpeg' });
    expect(r).toMatchObject({ ok: false, photoRejected: false });
    expect(g.calls).toHaveLength(1);
  });

  it('identifiant de session d\'une autre forme : refusé, le jeton ne part pas ailleurs', async () => {
    for (const id of ['https://evil.example.com/x', '../me', 'upload:abc/../../me', 'upload:..', 'upload:abc#frag', 'upload:a b', 'session', 42]) {
      const g = graph((c) => c.url.pathname.endsWith('/uploads') ? json(200, { id }) : undefined);
      const r = await uploadProfilePhoto(ctxOf(g), APP_ID, { bytes, type: 'image/jpeg' });
      expect(r.ok).toBe(false);
      expect(g.calls).toHaveLength(1);
    }
  });

  it('identifiant de session en base64 avec « / » : accepté, envoyé sous /<version>/upload: chez Graph', async () => {
    const id = 'upload:MTphdHRh/Y2htZW50+Ojk=?sig=ARZ/sig+value';
    const g = graph((c) => c.url.pathname.endsWith('/uploads') ? json(200, { id }) : undefined);
    const r = await uploadProfilePhoto(ctxOf(g), APP_ID, { bytes, type: 'image/jpeg' });
    expect(r.ok).toBe(true);
    expect(g.calls[1].url.origin).toBe('https://graph.facebook.com');
    expect(g.calls[1].url.pathname).toBe('/v26.0/upload:MTphdHRh/Y2htZW50+Ojk=');
    expect(g.calls[1].url.searchParams.has('appsecret_proof')).toBe(false);
  });

  it('réponse sans handle : échec', async () => {
    const g = graph((c) => c.url.pathname.startsWith('/v26.0/upload:') ? json(200, {}) : undefined);
    const r = await uploadProfilePhoto(ctxOf(g), APP_ID, { bytes, type: 'image/jpeg' });
    expect(r).toMatchObject({ ok: false, photoRejected: false });
  });

  it('message de Meta qui répète le jeton ou la signature de session : masqués', async () => {
    const g = graph((c) => c.url.pathname.startsWith('/v26.0/upload:')
      ? metaError(400, { code: 100, message: `HMAC check failed for ${creds.access_token} ${SESSION}` })
      : undefined);
    const r = await uploadProfilePhoto(ctxOf(g), APP_ID, { bytes, type: 'image/jpeg' });
    const text = JSON.stringify(r);
    expect(text).not.toContain(creds.access_token);
    expect(text).not.toContain('ARZsigValue0123');
  });
});

describe('setProfilePhoto (essai §4, étape 3)', () => {
  it('pose le handle sur le profil du numéro', async () => {
    const g = graph();
    const r = await setProfilePhoto(ctxOf(g), PN, '4::handle');
    expect(r).toEqual({ ok: true });
    expectAccountAuth(g.calls[0], `/v26.0/${PN}/whatsapp_business_profile`);
    expect(g.calls[0].body).toEqual({ messaging_product: 'whatsapp', profile_picture_handle: '4::handle' });
  });

  it('résolution trop faible : photoRejected', async () => {
    const g = graph(() => metaError(400, { code: 1, error_subcode: 3441013, message: 'Image trop petite' }));
    expect(await setProfilePhoto(ctxOf(g), PN, 'h')).toMatchObject({ ok: false, photoRejected: true });
  });
});

describe('requestDisplayName (essai §1)', () => {
  it('écrit new_display_name sur le numéro, avec le jeton du compte', async () => {
    const g = graph();
    const r = await requestDisplayName(ctxOf(g), PN, 'Wabagent Test');
    expect(r).toEqual({ ok: true });
    expect(g.calls).toHaveLength(1);
    expect(g.calls[0].method).toBe('POST');
    expectAccountAuth(g.calls[0], `/v26.0/${PN}`);
    expect(g.calls[0].body).toEqual({ new_display_name: 'Wabagent Test' });
  });

  it('réponse sans success : échec ; refus de Meta : échec avec son texte', async () => {
    expect((await requestDisplayName(ctxOf(graph(() => json(200, {}))), PN, 'x')).ok).toBe(false);
    const r = await requestDisplayName(ctxOf(graph(() => metaError(400, { code: 100, message: 'Invalid display name' }))), PN, 'x');
    expect(!r.ok && r.failure).toMatchObject({ kind: 'other', provider_text: 'Invalid display name' });
  });
});

describe('registerNumber (essai §3, spec R2a §6.3, §13.3)', () => {
  it('réenregistre le numéro : code et messaging_product dans le corps, jamais dans l\'adresse', async () => {
    const g = graph();
    const r = await registerNumber(ctxOf(g), PN, PIN);
    expect(r).toEqual({ ok: true });
    expect(g.calls).toHaveLength(1);
    expect(g.calls[0].method).toBe('POST');
    expectAccountAuth(g.calls[0], `/v26.0/${PN}/register`);
    expect(g.calls[0].body).toEqual({ messaging_product: 'whatsapp', pin: PIN });
    expect(g.calls[0].url.href).not.toContain(PIN);
  });

  it('mauvais code (133005, documentation de Meta) : pinRejected, expired false', async () => {
    const g = graph(() => metaError(400, { code: 133005, message: 'Two step verification PIN Mismatch' }));
    const r = await registerNumber(ctxOf(g), PN, PIN);
    expect(r).toMatchObject({ ok: false, pinRejected: true, expired: false });
  });

  it('autre refus : ni pinRejected ni expired', async () => {
    const g = graph(() => metaError(400, { code: 100, message: 'Invalid parameter' }));
    expect(await registerNumber(ctxOf(g), PN, PIN)).toMatchObject({ ok: false, pinRejected: false, expired: false });
    const down = await registerNumber(ctxOf(graph(() => metaError(503, { code: 2, message: 'down' }))), PN, PIN);
    expect(down).toMatchObject({ ok: false, pinRejected: false, expired: false, failure: { transient: true } });
  });

  // spec R2a §9.4
  it('le code n\'apparaît dans aucun échec ni journal, même quand Meta le répète', async () => {
    const logged: string[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { logged.push(args.map((a) => String(a)).join(' ')); });
    }
    const responders: Responder[] = [
      () => metaError(400, { code: 133005, message: `Two step verification PIN Mismatch: ${PIN}`, error_user_msg: PIN }),
      () => metaError(400, { code: 100, message: `Param pin=${PIN} is invalid` }),
      () => metaError(500, { code: 2, message: `Unexpected error with ${PIN}` }),
      () => json(400, `pin ${PIN}`),
      () => json(200, { success: false, pin: PIN }),
    ];
    const results: unknown[] = [];
    for (const respond of responders) results.push(await registerNumber(ctxOf(graph(respond)), PN, PIN));
    const timeout = (async () => { throw new DOMException('timeout', 'TimeoutError'); }) as typeof fetch;
    results.push(await registerNumber(makeContext(creds, { fetchImpl: timeout }), PN, PIN));
    const unreachable = (async () => { throw new Error(`connect ECONNREFUSED pin=${PIN}`); }) as typeof fetch;
    results.push(await registerNumber(makeContext(creds, { fetchImpl: unreachable }), PN, PIN));

    for (const r of results) {
      expect((r as { ok: boolean }).ok).toBe(false);
      expect(JSON.stringify(r)).not.toContain(PIN);
    }
    expect(logged.join('\n')).not.toContain(PIN);
  });
});
