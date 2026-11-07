import crypto from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';

/** Claims émis : le jeton ne porte plus que le sujet et le rôle plateforme (indicatif). */
export interface AccessClaims {
  sub: string;
  role: string;
}

/**
 * Claims vérifiés. `legacy_client_id` expose le `client_id` d'un jeton émis avant le
 * modèle de comptes ; il ne sert jamais à résoudre l'organisation ni les droits
 * (lus en base à chaque requête). Conservé seulement pour `scopeToClient`, supprimé
 * avec lui au recâblage des routes.
 */
export interface VerifiedAccessClaims extends AccessClaims {
  legacy_client_id: string | null;
}

function secretKey(): Uint8Array {
  const raw = config.adminJwt.secret;
  if (!raw) throw new Error('[Auth] ADMIN_JWT_SECRET is required');
  return new TextEncoder().encode(raw);
}

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role: claims.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + config.auth.accessTtlSeconds)
    .sign(secretKey());
}

export async function verifyAccessToken(token: string): Promise<VerifiedAccessClaims | null> {
  if (!config.adminJwt.secret) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || typeof payload.role !== 'string') return null;
    const clientId = payload.client_id;
    return {
      sub: payload.sub,
      role: payload.role,
      legacy_client_id: typeof clientId === 'string' ? clientId : null,
    };
  } catch {
    return null;
  }
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
