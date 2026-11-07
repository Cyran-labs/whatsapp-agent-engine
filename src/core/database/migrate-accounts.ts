// Migration idempotente vers le modèle de comptes (spec comptes et équipes, §11, étapes 2 à 5).
// L'étape 1 (tables et colonnes) est faite par les drivers à la création.

import type { EntityRecord, MembershipGrantRecord } from './accounts-types.js';
import type { Database } from './types.js';

export interface AccountsMigrationResult {
  entitiesCreated: number;
  botsAttached: number;
  adminsMigrated: number;
  invitationsMigrated: number;
}

const ADMIN_GRANT: MembershipGrantRecord = { entity_id: null, role: 'admin' };

/** Première entité active de l'organisation ; sinon en crée une nommée comme l'organisation. */
export async function ensureDefaultEntity(db: Database, clientId: string): Promise<EntityRecord> {
  const existing = await db.listEntities(clientId);
  const first = existing[0];
  if (first) return first;
  const client = await db.getClient(clientId);
  return db.createEntity(clientId, client?.name ?? clientId);
}

export async function migrateAccounts(db: Database): Promise<AccountsMigrationResult> {
  const result: AccountsMigrationResult = {
    entitiesCreated: 0, botsAttached: 0, adminsMigrated: 0, invitationsMigrated: 0,
  };

  // Étapes 2 et 3 : entité par défaut par organisation, puis rattachement des agents IA.
  const defaultEntityByClient = new Map<string, number>();
  for (const client of await db.listClients()) {
    const before = await db.listEntities(client.client_id);
    const entity = before.length > 0 ? before[0]! : await ensureDefaultEntity(db, client.client_id);
    if (before.length === 0) result.entitiesCreated += 1;
    defaultEntityByClient.set(client.client_id, entity.id);
  }
  for (const bot of await db.listBotRecords()) {
    if (bot.entity_id !== null) continue;
    const entityId = defaultEntityByClient.get(bot.client_id);
    if (entityId === undefined) continue;
    await db.setBotEntity(bot.client_id, bot.bot_id, entityId);
    result.botsAttached += 1;
  }

  // Étape 4 : client_admin vers appartenance admin au niveau organisation, puis rôle member.
  // Un compte encore « invited » n'a jamais accepté l'organisation : aucune appartenance
  // n'est créée, son invitation en attente (étape 5, grant admin) couvre l'acceptation.
  for (const user of await db.listUsersByRole('client_admin')) {
    if (!user.client_id) {
      console.warn(`[Accounts] client_admin ${user.id} sans client_id : ignoré par la migration`);
      continue;
    }
    if (user.status !== 'invited') {
      const memberships = (await db.listUserMemberships(user.id, user.client_id))
        .filter((m) => m.client_id === user.client_id);
      const alreadyAdmin = memberships.length === 1
        && memberships[0]!.entity_id === null && memberships[0]!.role === 'admin';
      if (!alreadyAdmin) {
        // Admin englobe tout : on remplace, sans lever une suspension déjà posée.
        const status = memberships.some((m) => m.status !== 'active') ? 'suspended' : 'active';
        await db.replaceMemberships(user.id, user.client_id, [ADMIN_GRANT], status);
        result.adminsMigrated += 1;
      }
    }
    await db.setUserRole(user.id, 'member');
  }

  // Étape 5 : invitations client_admin en attente. Les autres restent intactes.
  for (const inv of await db.listUnmigratedInvitations()) {
    if (inv.accepted_at !== null) continue;
    if (inv.role !== 'client_admin' || !inv.client_id) continue;
    await db.setInvitationGrants(inv.id, [ADMIN_GRANT]);
    result.invitationsMigrated += 1;
  }

  console.log(
    `[Accounts] migration: ${result.entitiesCreated} entité(s) créée(s), ${result.botsAttached} agent(s) IA rattaché(s), `
    + `${result.adminsMigrated} admin(s), ${result.invitationsMigrated} invitation(s)`,
  );
  return result;
}
