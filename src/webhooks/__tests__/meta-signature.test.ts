import { describe, expect, it } from 'vitest';
import { createHmac } from 'crypto';
import { verifyMetaSignature } from '../meta-signature.js';

const body = Buffer.from('{"entry":[{"id":"1"}]}', 'utf8');
const sign = (secret: string, payload: Buffer = body): string => 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');

describe('verifyMetaSignature', () => {
  it('bonne signature : vrai', () => {
    expect(verifyMetaSignature(body, sign('sek'), 'sek')).toBe(true);
  });

  // audit 4.2
  it('un octet du corps changé : faux', () => {
    const tampered = Buffer.from(body);
    tampered[3] = tampered[3]! ^ 0x01;
    expect(verifyMetaSignature(tampered, sign('sek'), 'sek')).toBe(false);
  });

  it("signature calculée avec un autre secret : faux", () => {
    expect(verifyMetaSignature(body, sign('autre'), 'sek')).toBe(false);
  });

  it('en-tête absent : faux', () => {
    expect(verifyMetaSignature(body, undefined, 'sek')).toBe(false);
  });

  it('en-tête vide ou sans préfixe sha256= : faux', () => {
    expect(verifyMetaSignature(body, '', 'sek')).toBe(false);
    expect(verifyMetaSignature(body, sign('sek').slice('sha256='.length), 'sek')).toBe(false);
  });

  it('en-tête tronqué ou rallongé : faux, sans exception', () => {
    expect(verifyMetaSignature(body, 'sha256=', 'sek')).toBe(false);
    expect(verifyMetaSignature(body, sign('sek').slice(0, -2), 'sek')).toBe(false);
    expect(verifyMetaSignature(body, sign('sek') + 'ab', 'sek')).toBe(false);
  });

  it("secret d'application vide : faux, même avec la signature d'un secret vide", () => {
    expect(verifyMetaSignature(body, sign(''), '')).toBe(false);
  });

  it("le secret d'application seul valide la signature (ni le jeton d'accès ni l'identifiant de numéro)", () => {
    expect(verifyMetaSignature(body, sign('s'), 's')).toBe(true);
    expect(verifyMetaSignature(body, sign('a'), 's')).toBe(false);
    expect(verifyMetaSignature(body, sign('p'), 's')).toBe(false);
  });
});
