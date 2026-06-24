import { cookies } from 'next/headers';

export const ACCESS_COOKIE = 'wab_access';
export const REFRESH_COOKIE = 'wab_refresh';

const baseCookie = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

export async function setSession(tokens: { access_token: string; refresh_token: string }): Promise<void> {
  const store = await cookies();
  store.set(ACCESS_COOKIE, tokens.access_token, { ...baseCookie });
  store.set(REFRESH_COOKIE, tokens.refresh_token, { ...baseCookie });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
}

export async function readAccess(): Promise<string | undefined> {
  return (await cookies()).get(ACCESS_COOKIE)?.value;
}

export async function readRefresh(): Promise<string | undefined> {
  return (await cookies()).get(REFRESH_COOKIE)?.value;
}
