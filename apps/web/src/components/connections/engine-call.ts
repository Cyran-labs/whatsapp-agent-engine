import { apiFetch, errorMessage, isOrgChanged } from '@/lib/api-fetch';

/** Détail d'un refus du moteur (`error.details[]`) : champ ou contrôle en cause, message. */
export interface EngineDetail {
  path: string;
  message?: string;
}

export interface EngineFailure {
  /** Message du moteur tel quel, ou le texte de repli (réseau, corps illisible). */
  message: string;
  status: number;
  details: EngineDetail[];
}

/**
 * Résultat d'un appel d'administration : succès (corps lu si présent), refus avec son message et ses détails,
 * ou 409 ORG_CHANGED (apiFetch recharge la page : l'appelant n'affiche rien et ne réessaie pas).
 */
export type EngineResult<T> =
  | { kind: 'ok'; status: number; data: T | null }
  | { kind: 'refused'; failure: EngineFailure }
  | { kind: 'org_changed' };

async function readDetails(res: Response): Promise<EngineDetail[]> {
  try {
    const body = (await res.json()) as { error?: { details?: unknown } };
    const details = body.error?.details;
    if (!Array.isArray(details)) return [];
    return details.flatMap((d): EngineDetail[] => {
      if (typeof d !== 'object' || d === null) return [];
      const { path, message } = d as { path?: unknown; message?: unknown };
      if (typeof path !== 'string') return [];
      return [typeof message === 'string' ? { path, message } : { path }];
    });
  } catch {
    return [];
  }
}

async function readData<T>(res: Response): Promise<T | null> {
  if (res.status === 204) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Appel d'administration via apiFetch (corps JSON facultatif). `service` préfixe le journal. */
export async function engineCall<T = unknown>(
  url: string,
  method: string,
  body: unknown,
  fallback: string,
  service: string,
): Promise<EngineResult<T>> {
  try {
    const res = await apiFetch(url, {
      method,
      ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    if (await isOrgChanged(res)) return { kind: 'org_changed' };
    if (res.ok) return { kind: 'ok', status: res.status, data: await readData<T>(res) };
    const details = await readDetails(res.clone());
    return { kind: 'refused', failure: { message: await errorMessage(res, fallback), status: res.status, details } };
  } catch (err) {
    console.error(`[${service}] envoi impossible`, err);
    return { kind: 'refused', failure: { message: fallback, status: 0, details: [] } };
  }
}

/** Identifiant de compte ou de numéro dans un chemin de route : toujours un entier, jamais du texte saisi. */
export const accountPath = (id: number): string => `/api/whatsapp-accounts/${id}`;
