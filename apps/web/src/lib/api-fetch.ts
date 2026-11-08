import { DISPLAYED_ORG_HEADER, ORG_CHANGED_CODE } from './session-errors';

/** Message affiché après une erreur d'organisation (spec §8). */
export type OrgNoticeKind = 'access' | 'suspended';

/** Liaison posée par le SessionProvider : organisation affichée et réactions de la session. */
export interface ApiFetchBinding {
  displayedOrg: string | null;
  /** 409 ORG_CHANGED : l'onglet affiche une organisation qui n'est plus celle du cookie. */
  onOrgChanged(): void;
  /** 403 suspendue, 403 d'appartenance, 400 organisation à préciser, 404 organisation introuvable. */
  onOrgError(kind: OrgNoticeKind): void;
  /** 401 : la session n'est plus renouvelable. */
  onUnauthorized(): void;
}

interface ErrorPayload {
  code?: string;
  message?: string;
  details?: Array<{ path?: string }>;
}

const SUSPENDED_MESSAGE = 'Organisation suspendue.';
const ORG_NOT_FOUND_MESSAGE = 'Organisation introuvable.';
const ENGINE_ORG_HEADER = 'X-Organization-Id';
const WATCHED_STATUSES = new Set([400, 403, 404, 409]);

let binding: ApiFetchBinding | null = null;

export function bindApiFetch(next: ApiFetchBinding | null): void {
  binding = next;
}

/** Une 403 de rôle est indistinguable d'une 403 d'appartenance : la session tranche après relecture. */
export function orgErrorKind(status: number, error: ErrorPayload | undefined): OrgNoticeKind | null {
  if (status === 403 && error?.message === SUSPENDED_MESSAGE) return 'suspended';
  if (status === 403 && error?.code === 'FORBIDDEN') return 'access';
  if (status === 400 && error?.details?.[0]?.path === ENGINE_ORG_HEADER) return 'access';
  if (status === 404 && error?.message === ORG_NOT_FOUND_MESSAGE) return 'access';
  return null;
}

async function readError(res: Response): Promise<ErrorPayload | undefined> {
  try {
    return ((await res.clone().json()) as { error?: ErrorPayload }).error;
  } catch {
    return undefined;
  }
}

function withDisplayedOrg(init: RequestInit | undefined, clientId: string): RequestInit {
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => {
    headers[key] = value;
  });
  headers[DISPLAYED_ORG_HEADER] = clientId;
  return { ...init, headers };
}

/**
 * fetch des routes d'administration du BFF : ajoute l'organisation affichée (X-Wab-Org) et
 * réagit aux erreurs de session et d'organisation. La réponse est rendue telle quelle à l'appelant.
 */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const current = binding;
  const nextInit = current?.displayedOrg ? withDisplayedOrg(init, current.displayedOrg) : init;
  // Arguments transmis tels quels quand il n'y a rien à ajouter.
  const res = await (nextInit === undefined ? fetch(input) : fetch(input, nextInit));
  if (!current || res.ok) return res;
  if (res.status === 401) {
    current.onUnauthorized();
    return res;
  }
  if (!WATCHED_STATUSES.has(res.status)) return res;
  const error = await readError(res);
  if (res.status === 409 && error?.code === ORG_CHANGED_CODE) {
    current.onOrgChanged();
    return res;
  }
  const kind = orgErrorKind(res.status, error);
  if (kind) current.onOrgError(kind);
  return res;
}

/** Message d'erreur du corps `{ error: { message } }`, sinon `fallback`. */
export async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message || fallback;
  } catch {
    return fallback;
  }
}

export type MutationResult = { res: Response } | { error: string };

/**
 * Mutation d'administration (corps JSON facultatif) via apiFetch : la réponse en cas de succès,
 * sinon le message du moteur, ou `fallback` (réseau, corps illisible). `service` préfixe le log.
 */
export async function sendMutation(
  url: string,
  method: string,
  body: unknown,
  fallback: string,
  service: string,
): Promise<MutationResult> {
  try {
    const res = await apiFetch(url, {
      method,
      ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    return res.ok ? { res } : { error: await errorMessage(res, fallback) };
  } catch (err) {
    console.error(`[${service}] envoi impossible`, err);
    return { error: fallback };
  }
}
