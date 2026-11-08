/** Jeton d'accès au format JWT (signature factice) : seul le sujet est lu par le BFF. */
export function fakeAccess(sub: number | string): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'HS256' })}.${part({ sub: String(sub), role: 'user' })}.signature`;
}
