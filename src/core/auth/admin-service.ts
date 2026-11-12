import type { Database, ClientRecord } from '../database/types.js';
import type { Mailer } from './mailer.js';
import { conflict, notFound } from '../../api/errors.js';
import { isUniqueViolation } from '../database/unique-violation.js';
import type { CreateClientInput } from '@wabagent/contracts';

export interface AdminServiceDeps {
  db: Database;
  /** Conservé pour la compatibilité des appelants ; les invitations relèvent de UserAdminService. */
  mailer: Mailer;
}

const CLIENT_ID_TAKEN = 'client_id déjà pris.';

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
   * Crée l'organisation et sa première entité, nommée `first_entity_name` (déjà validé par `CreateClientInput`), en
   * une transaction. Le `getClient` sert le chemin courant ; la clé primaire de `clients` est le garde réel face à une
   * création concurrente. `ensureDefaultEntity` reste réservé à la migration des organisations anciennes sans entité.
   */
  async createClient(input: CreateClientInput): Promise<ClientRecord> {
    if (await this.db.getClient(input.client_id)) throw conflict(CLIENT_ID_TAKEN);
    try {
      const { client } = await this.db.createClientWithEntity(
        { client_id: input.client_id, name: input.name, status: input.status },
        input.first_entity_name,
      );
      return client;
    } catch (err: unknown) {
      if (isUniqueViolation(err)) throw conflict(CLIENT_ID_TAKEN);
      throw err;
    }
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
