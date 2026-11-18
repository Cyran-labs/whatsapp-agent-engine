import type { NextResponse } from 'next/server';
import type { z } from 'zod';
import { engineFetch } from './engine-fetch';
import { errorResponse } from './api-response';
import { jsonResponse, emptyResponse } from './api-json';
import { unreadableBodyResponse, validateBody } from './request-body';
import type { ErrorReason } from '@wabagent/contracts';

export interface ProxyInit {
  method?: string;
  /** Valeur déjà lue, ou la `Request` entrante (corps lu ici : un corps non JSON donne un 400). */
  body?: unknown;
  schema?: z.ZodTypeAny;
  /** Statut renvoyé en cas de succès (200 par défaut). */
  status?: number;
}

const NUMERIC_ID = /^\d+$/;

/** Identifiant de chemin d'une route dynamique : chiffres seulement, sinon 404 sans appel moteur. */
export function rejectNonNumericId(id: string): NextResponse | null {
  if (NUMERIC_ID.test(id)) return null;
  return jsonResponse({ error: { code: 'NOT_FOUND', message: 'Ressource introuvable.' } }, { status: 404 });
}

/**
 * Relais BFF vers le moteur : valide le corps avec `schema` (400 standard sinon),
 * appelle `engineFetch`, renvoie le JSON du moteur (ou 204 si réponse vide).
 */
export async function proxyEngine(enginePath: string, init: ProxyInit = {}): Promise<NextResponse> {
  try {
    const method = init.method ?? 'GET';
    let body: unknown = init.body;
    if (body instanceof Request) {
      try {
        body = await body.json();
      } catch {
        return unreadableBodyResponse();
      }
    }
    if (init.schema) {
      const validated = validateBody(init.schema, body);
      if (!validated.ok) return validated.response;
      body = validated.data;
    }
    const result = await engineFetch<unknown>(enginePath, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (result === undefined) return emptyResponse(204);
    return jsonResponse(result, { status: init.status ?? 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * Texte du refus d'un fichier hors limite : le même que le moteur (`photo_invalid`, lot R2a). Le web traduit par la clé ;
 * ce texte ne sert qu'au repli français.
 */
const PHOTO_INVALID_TEXT = 'Photo refusée : JPEG ou PNG, 5 Mo au plus, 192 × 192 pixels au minimum.';
const PHOTO_INVALID_REASON: ErrorReason = 'whatsapp_account.photo_invalid';

/** Refus d'un fichier par le BFF, au format standard des refus du moteur (400, détail sur `photo`). */
function binaryRefused(): NextResponse {
  return jsonResponse(
    { error: { code: 'VALIDATION_ERROR', message: PHOTO_INVALID_TEXT, details: [{ path: 'photo', message: PHOTO_INVALID_TEXT }], reason: PHOTO_INVALID_REASON } },
    { status: 400 },
  );
}

/** Corps lu par morceaux, abandonné dès qu'il dépasse `maxBytes` (jamais tenu en entier au-delà) ; null s'il dépasse. */
async function readBoundedBody(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (request.body === null) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Relais BFF d'un fichier vers le moteur (photo du profil WhatsApp, lot R2a, spec R2a §6.2), sans le lire en JSON : le
 * type (`content-type` sans paramètres) doit être dans `allowedTypes` et la taille entre 1 octet et `maxBytes`, sinon
 * refus `photo_invalid` (400, format standard) sans appel au moteur. Sinon, les octets sont relayés tels quels avec leur
 * type, et la réponse du moteur est rendue comme par `proxyEngine`. Le contenu n'est jamais journalisé ni gardé.
 * `proxyEngine` (JSON) ne change pas.
 */
export async function proxyEngineBinary(
  enginePath: string,
  request: Request,
  allowedTypes: readonly string[],
  maxBytes: number,
): Promise<NextResponse> {
  const type = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (!allowedTypes.includes(type)) return binaryRefused();
  const declared = Number(request.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) return binaryRefused();
  let bytes: Uint8Array<ArrayBuffer> | null;
  try {
    bytes = await readBoundedBody(request, maxBytes);
  } catch {
    return binaryRefused();
  }
  if (bytes === null || bytes.byteLength === 0) return binaryRefused();
  try {
    const result = await engineFetch<unknown>(enginePath, { method: 'POST', headers: { 'content-type': type }, body: bytes });
    if (result === undefined) return emptyResponse(204);
    return jsonResponse(result);
  } catch (err) {
    return errorResponse(err);
  }
}
