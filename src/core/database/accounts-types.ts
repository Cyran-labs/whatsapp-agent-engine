// Types du module « comptes » : entités, appartenances, réglages d'organisation.
// Interface AccountsStore implémentée par accounts-sqlite.ts et accounts-postgres.ts,
// puis étalée dans les drivers (Database extends AccountsStore).

import type { InvitationRecord, UserRecord } from './types.js';

export type MembershipRole = 'admin' | 'super_manager' | 'manager' | 'advisor';
export type EntityStatus = 'active' | 'archived';
export type MembershipStatus = 'active' | 'suspended';

export interface EntityRecord {
  id: number;
  client_id: string;
  name: string;
  status: EntityStatus;
  created_at: string;
  updated_at: string;
}

export interface MembershipRecord {
  id: number;
  user_id: number;
  client_id: string;
  entity_id: number | null;
  role: MembershipRole;
  read_only: boolean;
  status: MembershipStatus;
}

export interface MembershipGrantRecord {
  entity_id: number | null;
  role: MembershipRecord['role'];
  read_only?: boolean;
}

export interface AccountsStore {
  // Entités
  listEntities(clientId: string, opts?: { includeArchived?: boolean }): Promise<EntityRecord[]>;
  getEntity(clientId: string, id: number): Promise<EntityRecord | undefined>;
  createEntity(clientId: string, name: string): Promise<EntityRecord>;
  updateEntity(clientId: string, id: number, patch: { name?: string; status?: EntityStatus }): Promise<void>;
  countEntityUsage(clientId: string, entityId: number): Promise<{ bots: number; activeMembers: number }>;

  // Appartenances
  listUserMemberships(userId: number, clientId?: string): Promise<MembershipRecord[]>;
  listOrgMemberships(clientId: string): Promise<MembershipRecord[]>;
  /**
   * Transaction : supprime les appartenances (userId, clientId) puis insère les grants
   * avec le statut donné (défaut active ; permet de garder une suspension en place).
   */
  replaceMemberships(userId: number, clientId: string, grants: MembershipGrantRecord[], status?: MembershipStatus): Promise<void>;
  setMembershipsStatus(userId: number, clientId: string, status: MembershipStatus): Promise<void>;
  /** Organisations où l'utilisateur a au moins une appartenance active. */
  listUserOrganizations(userId: number): Promise<{ client_id: string; name: string }[]>;

  // Réglages d'organisation ({} si absents)
  getClientSettings(clientId: string): Promise<Record<string, unknown>>;
  setClientSettings(clientId: string, settings: Record<string, unknown>): Promise<void>;

  // Agents IA
  setBotEntity(clientId: string, botId: string, entityId: number): Promise<void>;

  // Utilisateurs (rôle plateforme)
  setUserRole(userId: number, role: string): Promise<void>;
  listUsersByRole(role: string): Promise<UserRecord[]>;

  // Invitations
  /** Non acceptées, non expirées, tri created_at croissant. */
  listPendingInvitationsByEmail(email: string): Promise<InvitationRecord[]>;
  refreshInvitationToken(id: number, tokenHash: string, expiresAt: string): Promise<void>;
  /** Invitations dont grants est null (antérieures au modèle de comptes). */
  listUnmigratedInvitations(): Promise<InvitationRecord[]>;
  setInvitationGrants(id: number, grants: MembershipGrantRecord[]): Promise<void>;
}
