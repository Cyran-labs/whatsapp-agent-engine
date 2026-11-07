import type { Database, ClientRecord } from '../database/types.js';
import type { Mailer } from './mailer.js';
import { conflict, notFound } from '../../api/errors.js';
import { ensureDefaultEntity } from '../database/migrate-accounts.js';

export interface AdminServiceDeps {
  db: Database;
  /** Conservé pour la compatibilité des appelants ; les invitations relèvent de UserAdminService. */
  mailer: Mailer;
}

/** Organisations (clients) : réservé au super admin. Les invitations sont dans UserAdminService. */
export class AdminService {
  private readonly db: Database;

  constructor(deps: AdminServiceDeps) {
    this.db = deps.db;
  }

  async listClients(): Promise<ClientRecord[]> {
    return this.db.listClients();
  }

  async createClient(input: { client_id: string; name: string; status: string }): Promise<ClientRecord> {
    if (await this.db.getClient(input.client_id)) throw conflict('client_id déjà pris.');
    await this.db.upsertClient({ client_id: input.client_id, name: input.name, status: input.status });
    await ensureDefaultEntity(this.db, input.client_id);
    return (await this.db.getClient(input.client_id))!;
  }

  async updateClient(clientId: string, patch: { name?: string; status?: string }): Promise<ClientRecord> {
    const existing = await this.db.getClient(clientId);
    if (!existing) throw notFound('Client introuvable.');
    await this.db.upsertClient({
      client_id: clientId,
      name: patch.name ?? existing.name,
      status: patch.status ?? existing.status,
    });
    return (await this.db.getClient(clientId))!;
  }
}
