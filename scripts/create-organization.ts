import 'dotenv/config';
import { initDatabase } from '../src/core/database/index.js';
import { createMailer } from '../src/core/auth/mailer.js';
import { AdminService } from '../src/core/auth/admin-service.js';
import { UserAdminService } from '../src/core/services/user-admin-service.js';
import { normalizeEmail } from '../src/core/auth/email.js';

const CLIENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

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
  if (!adminEmail.includes('@')) fail('email_admin invalide.');
  const email = normalizeEmail(adminEmail);

  const db = await initDatabase();
  try {
    const mailer = createMailer();
    const admin = new AdminService({ db, mailer });
    const users = new UserAdminService({ db, mailer });

    const client = await admin.createClient({ client_id: clientId, name, status: 'active' });
    // Le lien d'invitation n'est écrit que dans les journaux du serveur (ConsoleMailer), jamais ici.
    await users.invite(client.client_id, null, email, [{ entity_id: null, role: 'admin' }]);
    console.log(`[CreateOrganization] organisation ${client.client_id} créée, invitation envoyée à ${email}`);
  } finally {
    await db.close();
  }
}

main().catch((err: unknown) => {
  console.error('[CreateOrganization] Échec:', err instanceof Error ? err.message : err);
  process.exit(1);
});
