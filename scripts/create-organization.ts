import 'dotenv/config';
import { initDatabase } from '../src/core/database/index.js';
import { createMailer } from '../src/core/auth/mailer.js';
import { AdminService } from '../src/core/auth/admin-service.js';
import { UserAdminService } from '../src/core/services/user-admin-service.js';
import { normalizeEmail } from '../src/core/auth/email.js';

const CLIENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(message: string): never {
  console.error(`[CreateOrganization] ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const clientId = (process.argv[2] ?? '').trim();
  const name = (process.argv[3] ?? '').trim();
  const adminEmail = (process.argv[4] ?? '').trim();
  if (!clientId || !name || !adminEmail) {
    fail('Usage: tsx scripts/create-organization.ts <client_id> "<Nom>" <email_admin>');
  }
  if (!CLIENT_ID_PATTERN.test(clientId)) {
    fail('client_id invalide : minuscules, chiffres et tirets, 64 caractères maximum, sans tiret initial.');
  }
  if (!EMAIL_PATTERN.test(adminEmail)) fail(`email_admin invalide : ${adminEmail}`);
  const email = normalizeEmail(adminEmail);

  const db = await initDatabase();
  try {
    const mailer = createMailer();
    const admin = new AdminService({ db, mailer });
    const users = new UserAdminService({ db, mailer });

    // Idempotent : si l'organisation existe déjà (échec précédent après sa création), on reprend
    // à l'invitation, à condition qu'elle n'ait pas encore d'admin actif.
    const existing = await db.getClient(clientId);
    if (existing) {
      const hasAdmin = (await db.listOrgMemberships(clientId)).some(
        (m) => m.client_id === clientId && m.entity_id === null && m.role === 'admin' && m.status === 'active',
      );
      if (hasAdmin) fail(`Échec: l'organisation ${clientId} a déjà un admin.`);
    } else {
      await admin.createClient({ client_id: clientId, name, status: 'active' });
    }

    try {
      // Le lien d'invitation n'est écrit que dans les journaux du serveur (ConsoleMailer), jamais ici.
      await users.invite(clientId, null, email, [{ entity_id: null, role: 'admin' }]);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      fail(`Échec: organisation ${clientId} créée mais invitation non envoyée (${reason}). Relancez la même commande.`);
    }
    console.log(`[CreateOrganization] organisation ${clientId} créée, invitation envoyée à ${email}`);
  } finally {
    await db.close();
  }
}

main().catch((err: unknown) => {
  console.error('[CreateOrganization] Échec:', err instanceof Error ? err.message : err);
  process.exit(1);
});
