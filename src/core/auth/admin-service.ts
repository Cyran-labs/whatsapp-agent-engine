import type { Database, ClientRecord, InvitationRecord } from '../database/types.js';
import type { Mailer } from './mailer.js';
import { config } from '../config.js';
import { conflict, notFound, validationError } from '../../api/errors.js';
import { generateRefreshToken, hashRefreshToken } from './tokens.js';

export interface InvitationPublic {
  id: number;
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
}

export interface AdminServiceDeps {
  db: Database;
  mailer: Mailer;
}

function toInvitationPublic(inv: InvitationRecord): InvitationPublic {
  return { id: inv.id, email: inv.email, role: inv.role, expires_at: inv.expires_at, accepted_at: inv.accepted_at };
}

export class AdminService {
  private readonly db: Database;
  private readonly mailer: Mailer;

  constructor(deps: AdminServiceDeps) {
    this.db = deps.db;
    this.mailer = deps.mailer;
  }

  async listClients(): Promise<ClientRecord[]> {
    return this.db.listClients();
  }

  async createClient(input: { client_id: string; name: string; status: string }): Promise<ClientRecord> {
    if (await this.db.getClient(input.client_id)) throw conflict('client_id déjà pris.');
    await this.db.upsertClient({ client_id: input.client_id, name: input.name, status: input.status });
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

  async createInvitation(clientId: string | null, email: string, role: string): Promise<{ id: number; email: string; role: string }> {
    if (clientId && role === 'super_admin') {
      throw validationError([{ path: 'role', message: 'Un super_admin ne peut pas être invité sur un client.' }]);
    }
    if (clientId && !(await this.db.getClient(clientId))) throw notFound('Client introuvable.');

    const existingUser = await this.db.getUserByEmail(email);
    if (existingUser && existingUser.status === 'active') throw conflict('Utilisateur déjà actif.');
    if (existingUser && existingUser.status === 'invited' && (existingUser.role !== role || existingUser.client_id !== clientId)) {
      throw conflict('Une invitation avec un rôle ou un client différent existe déjà pour cet email.');
    }
    if (!existingUser) {
      await this.db.createUser({ email, password_hash: null, role, client_id: clientId, status: 'invited' });
    }

    const token = generateRefreshToken();
    const expiresAt = new Date(Date.now() + config.auth.inviteTtlDays * 86400_000).toISOString();
    const inv = await this.db.createInvitation({
      email, client_id: clientId, role, token_hash: hashRefreshToken(token), expires_at: expiresAt,
    });
    const link = `${config.auth.webOrigin}/accept-invite?token=${token}`;
    await this.mailer.sendInvitation(email, link);
    return { id: inv.id, email: inv.email, role: inv.role };
  }

  async listInvitations(clientId: string): Promise<InvitationPublic[]> {
    return (await this.db.listInvitations(clientId)).map(toInvitationPublic);
  }

  async revokeInvitation(clientId: string, invitationId: number): Promise<void> {
    const list = await this.db.listInvitations(clientId);
    if (!list.some((i) => i.id === invitationId)) throw notFound('Invitation introuvable.');
    await this.db.deleteInvitation(invitationId);
  }
}
