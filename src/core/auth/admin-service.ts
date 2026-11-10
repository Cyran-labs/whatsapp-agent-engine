import type { Database, ClientRecord } from '../database/types.js';
import type { Mailer } from './mailer.js';
import { conflict, notFound } from '../../api/errors.js';
import type { CreateClientInput } from '@wabagent/contracts';

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

  /**
   * Crée l'organisation puis sa première entité, nommée `first_entity_name` (déjà validé par `CreateClientInput`).
   * `ensureDefaultEntity` reste réservé à la migration des organisations anciennes sans entité.
   */
  async createClient(input: CreateClientInput): Promise<ClientRecord> {
    if (await this.db.getClient(input.client_id)) throw conflict('client_id déjà pris.');
    await this.db.upsertClient({ client_id: input.client_id, name: input.name, status: input.status });
    await this.db.createEntity(input.client_id, input.first_entity_name);
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
