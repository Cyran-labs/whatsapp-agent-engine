/**
 * Violation d'unicité (clé primaire ou index unique), SQLite ou Postgres : filet de sécurité face à une création
 * concurrente. Une autre contrainte (NOT NULL, CHECK, clé étrangère) n'en est pas une.
 */
export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code === '23505') return true;
  if (e.code === 'SQLITE_CONSTRAINT_UNIQUE' || e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return true;
  return typeof e.message === 'string' && e.message.includes('UNIQUE constraint failed');
}
