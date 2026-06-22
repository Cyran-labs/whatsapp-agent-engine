import type { Database, AuditLogInput } from './database/types.js';

/**
 * Journalise une mutation admin (best-effort). N'échoue jamais : une erreur
 * d'audit ne doit pas casser l'opération métier qui l'a déclenchée.
 */
export async function recordAudit(db: Database, entry: AuditLogInput): Promise<void> {
  try {
    await db.insertAuditLog(entry);
  } catch (err) {
    console.error('[Audit] Échec écriture audit_log:', err);
  }
}
