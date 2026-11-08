import { engineCall, EngineError } from './engine-client';
import { isOpenable, type Me } from './organizations';
import { SESSION_EXPIRED_MESSAGE } from './session-errors';
import { readAccess, readRefresh, readOrg, setSession, clearSession, clearOrg } from './session';

interface AuthResult {
  access_token: string;
  refresh_token: string;
  user: unknown;
}

const SUSPENDED_MESSAGE = 'Organisation suspendue.';
const ORG_NOT_FOUND_MESSAGE = 'Organisation introuvable.';
const ORG_HEADER = 'X-Organization-Id';

async function call<T>(
  path: string,
  access: string | undefined,
  org: string | undefined,
  init?: RequestInit,
): Promise<T> {
  return engineCall<T>(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(access ? { authorization: `Bearer ${access}` } : {}),
      ...(org ? { [ORG_HEADER]: org } : {}),
    },
  });
}

/** 400 « Organisation à préciser » : le cookie wab_org est périmé. */
function isOrgRequiredError(err: EngineError): boolean {
  return err.status === 400 && err.details?.[0]?.path === ORG_HEADER;
}

/** 404 « Organisation introuvable. » : organisation supprimée (cas du super admin), cookie périmé. */
function isOrgNotFoundError(err: EngineError): boolean {
  return err.status === 404 && err.message === ORG_NOT_FOUND_MESSAGE;
}

/** 403 générique : refus de rôle ou d'appartenance, indistinguables par le message. */
function isAmbiguousForbidden(err: EngineError): boolean {
  return err.status === 403 && err.code === 'FORBIDDEN' && err.message !== SUSPENDED_MESSAGE;
}

/**
 * Efface wab_org seulement si l'organisation n'est plus accessible à l'utilisateur
 * (vérifiée via /auth/me, sans en-tête d'organisation). Si la vérification échoue, le cookie est gardé.
 */
async function clearOrgIfInaccessible(access: string | undefined, org: string | undefined): Promise<void> {
  if (!org) return;
  try {
    const me = await call<Me>('/auth/me', access, undefined);
    const current = me.organizations.find((o) => o.client_id === org);
    if (!current || !isOpenable(current)) await clearOrg();
  } catch {
    // vérification impossible : on garde le cookie
  }
}

export async function engineFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const access = await readAccess();
  const org = await readOrg();
  try {
    return await call<T>(path, access, org, init);
  } catch (err) {
    if (err instanceof EngineError) {
      if (isOrgRequiredError(err) || isOrgNotFoundError(err)) await clearOrg();
      else if (isAmbiguousForbidden(err)) await clearOrgIfInaccessible(access, org);
    }
    if (!(err instanceof EngineError) || err.status !== 401) throw err;
    const refresh = await readRefresh();
    if (!refresh) {
      await clearSession();
      throw new EngineError('UNAUTHORIZED', SESSION_EXPIRED_MESSAGE, 401);
    }
    let refreshed: AuthResult;
    try {
      refreshed = await engineCall<AuthResult>('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: refresh }),
      });
    } catch {
      await clearSession();
      throw new EngineError('UNAUTHORIZED', SESSION_EXPIRED_MESSAGE, 401);
    }
    await setSession(refreshed);
    return call<T>(path, refreshed.access_token, org, init);
  }
}
