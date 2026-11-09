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

/**
 * La réponse est-elle le 409 ORG_CHANGED ? apiFetch recharge alors la page : l'appelant ne doit
 * ni réessayer ni afficher d'erreur. À tester avant toute lecture du corps (la réponse est clonée).
 */
export async function isOrgChanged(res: Response): Promise<boolean> {
  if (res.status !== 409) return false;
  return (await readError(res))?.code === ORG_CHANGED_CODE;
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

/** Détail d'un refus du moteur (`error.details[]`) : champ ou contrôle en cause et son message. */
export interface MutationDetail {
  path: string;
  message?: string;
}

/**
 * Refus d'une mutation : `error` est le message du moteur (ou `fallback`), `status` le statut HTTP (0 : réseau),
 * `details` les détails du moteur, `orgChanged` vrai pour le 409 ORG_CHANGED (apiFetch recharge alors la page :
 * l'appelant n'affiche rien de plus).
 */
export interface MutationFailure {
  error: string;
  status: number;
  details: MutationDetail[];
  orgChanged: boolean;
}

export type MutationResult = { res: Response } | MutationFailure;

async function readDetails(res: Response): Promise<MutationDetail[]> {
  try {
    const details = ((await res.json()) as { error?: { details?: unknown } }).error?.details;
    if (!Array.isArray(details)) return [];
    return details.flatMap((d): MutationDetail[] => {
      if (typeof d !== 'object' || d === null) return [];
      const { path, message } = d as { path?: unknown; message?: unknown };
      if (typeof path !== 'string') return [];
      return [typeof message === 'string' ? { path, message } : { path }];
    });
  } catch {
    return [];
  }
}

/** Corps JSON d'une réponse réussie, null s'il est absent (204) ou illisible. */
export async function readJsonBody<T>(res: Response): Promise<T | null> {
  if (res.status === 204) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Mutation d'administration (corps JSON facultatif) via apiFetch : la réponse en cas de succès,
 * sinon le refus (message du moteur, statut, détails, 409 ORG_CHANGED) ou `fallback` (réseau, corps illisible).
 * `service` préfixe le log.
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
    if (res.ok) return { res };
    const orgChanged = await isOrgChanged(res);
    const details = await readDetails(res.clone());
    return { error: await errorMessage(res, fallback), status: res.status, details, orgChanged };
  } catch (err) {
    console.error(`[${service}] envoi impossible`, err);
    return { error: fallback, status: 0, details: [], orgChanged: false };
  }
}
