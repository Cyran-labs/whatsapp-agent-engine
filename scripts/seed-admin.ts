import 'dotenv/config';
import { initDatabase } from '../src/core/database/index.js';
import { hashPassword } from '../src/core/auth/passwords.js';

async function main(): Promise<void> {
  const email = (process.argv[2] || process.env['SEED_ADMIN_EMAIL'] || '').trim().toLowerCase();
  const password = process.argv[3] || process.env['SEED_ADMIN_PASSWORD'] || '';
  if (!email || !password) {
    console.error('[SeedAdmin] Usage: tsx scripts/seed-admin.ts <email> <password> (ou SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD)');
    process.exit(1);
  }
  if (password.length < 10) {
    console.error('[SeedAdmin] Le mot de passe doit faire au moins 10 caractères.');
    process.exit(1);
  }

  const db = await initDatabase();
  const existing = await db.getUserByEmail(email);
  if (existing) {
    console.log(`[SeedAdmin] L'utilisateur ${email} existe déjà (id=${existing.id}), rien à faire.`);
    await db.close();
    return;
  }
  const user = await db.createUser({
    email, password_hash: await hashPassword(password), role: 'super_admin', client_id: null, status: 'active',
  });
  console.log(`[SeedAdmin] super_admin créé: ${email} (id=${user.id})`);
  await db.close();
}

main().catch((err) => {
  console.error('[SeedAdmin] Échec:', err);
  process.exit(1);
});
