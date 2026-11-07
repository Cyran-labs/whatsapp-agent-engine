// Utilisateurs d'une organisation : invitations, appartenances, suspension (spec comptes et équipes, §4 et §8).
// Tout est relu en base à chaque appel : aucun état en mémoire.
// Règle d'isolement : toute opération sur un utilisateur ou une invitation est bornée à
// l'organisation passée en argument ; un objet d'une autre organisation répond 404.

import type { ClientRecord, Database, InvitationRecord, UserRecord } from '../database/types.js';
import type { MembershipGrantRecord, MembershipRecord, MembershipStatus } from '../database/accounts-types.js';
import type { Mailer } from '../auth/mailer.js';
import { config } from '../config.js';
import { recordAudit } from '../audit.js';
import { generateRefreshToken, hashRefreshToken } from '../auth/tokens.js';
import { conflict, notFound, validationError } from '../../api/errors.js';

export interface UserAdminServiceDeps {
  db: Database;
  mailer: Mailer;
}

/** Invitation telle qu'exposée par l'API : jamais de jeton ni de lien. */
export interface InvitationPublic {
  id: number;
  email: string;
  grants: MembershipGrantRecord[] | null;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export type MemberMembership = Omit<MembershipRecord, 'id' | 'user_id' | 'client_id'>;

export interface MemberSummary {
  user_id: number;
  email: string;
  status: string;
  memberships: MemberMembership[];
}

export type InviteOutcome = 'invited' | 'added';

const LAST_ADMIN = "L'organisation doit garder au moins un admin.";
const ALREADY_MEMBER = 'Cette personne est déjà membre de l\'organisation : modifiez ses accès.';
const ACCOUNT_DISABLED = 'Ce compte est désactivé.';
const NOT_INVITABLE = 'Ce compte ne peut pas être invité.';
const ALREADY_ACTIVE = 'Cette personne a déjà un compte actif.';
const INVALID_ENTITY = 'Entité introuvable ou archivée.';
const INVALID_GRANTS = 'Rôles invalides.';

/** Rôle plateforme, relu sur l'utilisateur : jamais attribuable par une organisation. */
const PLATFORM_ADMIN_ROLE = 'super_admin';
/** Rôle plateforme des comptes créés par invitation. */
const MEMBER_ROLE = 'member';

const ORG_ROLES: ReadonlySet<string> = new Set(['admin', 'super_manager']);
const ENTITY_ROLES: ReadonlySet<string> = new Set(['manager', 'advisor']);

function toInvitationPublic(inv: InvitationRecord): InvitationPublic {
  return {
    id: inv.id, email: inv.email, grants: inv.grants,
    expires_at: inv.expires_at, accepted_at: inv.accepted_at, created_at: inv.created_at,
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function inviteExpiry(): string {
  return new Date(Date.now() + config.auth.inviteTtlDays * 86400_000).toISOString();
}

function inviteLink(token: string): string {
  return `${config.auth.webOrigin}/accept-invite?token=${token}`;
}

/**
 * Forme d'un ensemble de grants (défense en profondeur : les routes valident déjà par Zod,
 * mais le service est aussi appelé par des scripts). Soit une grant d'organisation, soit des
 * grants d'entité aux identifiants distincts ; lecture seule seulement sur super manager.
 * Exportée pour `AuthService.acceptInvite`, qui relit des grants stockées.
 */
export function isWellFormedGrants(grants: readonly MembershipGrantRecord[]): boolean {
  if (grants.length === 0) return false;
  const orgGrants = grants.filter((g) => g.entity_id === null);
  const entityGrants = grants.filter((g) => g.entity_id !== null);
  if (orgGrants.length > 1 || (orgGrants.length === 1 && entityGrants.length > 0)) return false;
  for (const g of orgGrants) {
    if (!ORG_ROLES.has(g.role)) return false;
    if (g.read_only === true && g.role !== 'super_manager') return false;
  }
  const seen = new Set<number>();
  for (const g of entityGrants) {
    if (!ENTITY_ROLES.has(g.role)) return false;
    if (!Number.isSafeInteger(g.entity_id) || (g.entity_id ?? 0) <= 0) return false;
    if (g.read_only === true) return false;
    if (seen.has(g.entity_id!)) return false;
    seen.add(g.entity_id!);
  }
  return true;
}

/** Copie normalisée : read_only seulement s'il est vrai (sur un super manager). */
function cleanGrants(grants: readonly MembershipGrantRecord[]): MembershipGrantRecord[] {
  return grants.map((g) => (g.read_only === true
    ? { entity_id: g.entity_id, role: g.role, read_only: true }
    : { entity_id: g.entity_id, role: g.role }));
}

/** Admin qui compte pour la garde « dernier admin » : appartenance d'organisation admin active d'un compte actif non plateforme. */
function isCountedAdmin(m: MembershipRecord, user: UserRecord | undefined): boolean {
  return m.entity_id === null && m.role === 'admin' && m.status === 'active'
    && user !== undefined && user.status === 'active' && user.role !== PLATFORM_ADMIN_ROLE;
}

export class UserAdminService {
  private readonly db: Database;
  private readonly mailer: Mailer;

  constructor(deps: UserAdminServiceDeps) {
    this.db = deps.db;
    this.mailer = deps.mailer;
  }

  /** Utilisateurs ayant au moins une appartenance (active ou suspendue) dans l'organisation. */
  async listMembers(clientId: string): Promise<MemberSummary[]> {
    const byUser = new Map<number, MemberMembership[]>();
    for (const m of await this.db.listOrgMemberships(clientId)) {
      if (m.client_id !== clientId) continue;
      const list = byUser.get(m.user_id) ?? [];
      list.push({ entity_id: m.entity_id, role: m.role, read_only: m.read_only, status: m.status });
      byUser.set(m.user_id, list);
    }
    const members: MemberSummary[] = [];
    for (const [userId, memberships] of byUser) {
      const user = await this.db.getUserById(userId);
      if (!user) continue;
      members.push({ user_id: user.id, email: user.email, status: user.status, memberships });
    }
    return members;
  }

  async listInvitations(clientId: string): Promise<InvitationPublic[]> {
    return (await this.db.listInvitations(clientId))
      .filter((inv) => inv.client_id === clientId)
      .map(toInvitationPublic);
  }

  /**
   * Invite une adresse dans l'organisation.
   * - compte actif (membre d'une autre organisation) : appartenances créées directement, e-mail d'information, `added` ;
   * - compte désactivé : 409 ;
   * - déjà membre de cette organisation (actif ou suspendu) : 409 (Ruling R19) ;
   * - sinon : compte invité créé au besoin, invitation à usage unique, `invited`.
   */
  async invite(
    clientId: string,
    actorUserId: number | null,
    email: string,
    grants: MembershipGrantRecord[],
  ): Promise<{ email: string; outcome: InviteOutcome }> {
    const client = await this.requireClient(clientId);
    const normalized = normalizeEmail(email);
    const clean = await this.validateGrants(clientId, grants);

    const existing = await this.db.getUserByEmail(normalized);
    if (existing) {
      if (existing.status === 'disabled') throw conflict(ACCOUNT_DISABLED);
      if ((await this.membershipsIn(existing.id, clientId)).length > 0) throw conflict(ALREADY_MEMBER);
    }

    if (existing && existing.status === 'active') {
      await this.db.replaceMemberships(existing.id, clientId, clean);
      try {
        await this.mailer.sendAccessGranted(normalized, client.name);
      } catch (err) {
        // L'accès est créé ; l'e-mail n'est qu'informatif.
        console.error('[UserAdminService] Échec envoi du mail d\'accès accordé:', err);
      }
      await recordAudit(this.db, {
        actor_user_id: actorUserId, action: 'user.invite', target: `user:${existing.id}`,
        client_id: clientId, metadata: { email: normalized, outcome: 'added', grants: clean },
      });
      return { email: normalized, outcome: 'added' };
    }

    // Seul un compte « invited » (ou absent) reçoit une invitation ; tout autre statut est refusé.
    if (existing && existing.status !== 'invited') throw conflict(ACCOUNT_DISABLED);
    // Un compte invité qui n'est pas un simple membre (héritage, ex. super admin invité) n'est jamais réutilisé (R23a).
    if (existing && existing.role !== MEMBER_ROLE) throw conflict(NOT_INVITABLE);
    const user = existing ?? await this.db.createUser({
      email: normalized, password_hash: null, role: MEMBER_ROLE, client_id: null, status: 'invited',
    });

    // Une invitation en attente pour cette organisation est renouvelée plutôt que doublée (R23b) :
    // nouveau jeton (l'ancien est invalidé), grants remplacées, échéance repartie.
    const token = generateRefreshToken();
    const sameOrg = (await this.db.listPendingInvitationsByEmail(normalized))
      .filter((p) => p.client_id === clientId);
    const rotated = sameOrg[sameOrg.length - 1];
    let invitationId: number;
    if (rotated) {
      await this.db.refreshInvitationToken(rotated.id, hashRefreshToken(token), inviteExpiry());
      await this.db.setInvitationGrants(rotated.id, clean);
      // Doublons hérités (antérieurs à la rotation) : supprimés pour ne garder qu'un lien valide.
      for (const dup of sameOrg) if (dup.id !== rotated.id) await this.db.deleteInvitation(dup.id);
      invitationId = rotated.id;
    } else {
      const inv = await this.db.createInvitation({
        email: normalized, client_id: clientId, role: MEMBER_ROLE,
        token_hash: hashRefreshToken(token), expires_at: inviteExpiry(), grants: clean,
      });
      invitationId = inv.id;
    }
    await this.mailer.sendInvitation(normalized, inviteLink(token));
    await recordAudit(this.db, {
      actor_user_id: actorUserId, action: 'user.invite', target: `user:${user.id}`,
      client_id: clientId, metadata: { email: normalized, outcome: 'invited', invitation_id: invitationId, rotated: rotated !== undefined, grants: clean },
    });
    return { email: normalized, outcome: 'invited' };
  }

  /** Nouveau jeton (l'ancien est invalidé), nouvelle échéance, nouvel e-mail. */
  async resendInvitation(clientId: string, actorUserId: number, invitationId: number): Promise<void> {
    const inv = await this.requireInvitation(clientId, invitationId);
    if (inv.accepted_at !== null) throw conflict('Cette invitation a déjà été acceptée.');
    const user = await this.db.getUserByEmail(inv.email);
    if (user && user.status === 'disabled') throw conflict(ACCOUNT_DISABLED);
    if (user && user.status === 'active') throw conflict(ALREADY_ACTIVE);

    const token = generateRefreshToken();
    await this.db.refreshInvitationToken(inv.id, hashRefreshToken(token), inviteExpiry());
    await this.mailer.sendInvitation(inv.email, inviteLink(token));
    await recordAudit(this.db, {
      actor_user_id: actorUserId, action: 'user.invite.resend', target: `invitation:${inv.id}`,
      client_id: clientId, metadata: { email: inv.email },
    });
  }

  async revokeInvitation(clientId: string, invitationId: number, actorUserId: number | null = null): Promise<void> {
    const inv = await this.requireInvitation(clientId, invitationId);
    await this.db.deleteInvitation(inv.id);
    await recordAudit(this.db, {
      actor_user_id: actorUserId, action: 'user.invite.revoke', target: `invitation:${inv.id}`,
      client_id: clientId, metadata: { email: inv.email },
    });
  }

  /** Remplace les appartenances de l'utilisateur dans l'organisation ; une suspension reste en place. */
  async setMemberships(clientId: string, actorUserId: number, userId: number, grants: MembershipGrantRecord[]): Promise<void> {
    const current = await this.requireMember(clientId, userId);
    const clean = await this.validateGrants(clientId, grants);
    const status: MembershipStatus = current.some((m) => m.status !== 'active') ? 'suspended' : 'active';

    const keepsAdmin = status === 'active' && clean.some((g) => g.entity_id === null && g.role === 'admin');
    if (!keepsAdmin) await this.assertNotLastAdmin(clientId, userId);

    await this.db.replaceMemberships(userId, clientId, clean, status);
    await recordAudit(this.db, {
      actor_user_id: actorUserId, action: 'user.memberships', target: `user:${userId}`,
      client_id: clientId, metadata: { grants: clean },
    });
  }

  /** Suspension ou réactivation dans cette organisation seulement. */
  async setStatus(clientId: string, actorUserId: number, userId: number, status: 'active' | 'suspended'): Promise<void> {
    await this.requireMember(clientId, userId);
    if (status === 'suspended') await this.assertNotLastAdmin(clientId, userId);
    await this.db.setMembershipsStatus(userId, clientId, status);
    await recordAudit(this.db, {
      actor_user_id: actorUserId, action: 'user.status', target: `user:${userId}`,
      client_id: clientId, metadata: { status },
    });
  }

  /** Désactivation globale (super admin) : plus aucune connexion, toutes les sessions révoquées. */
  async disableGlobally(actorUserId: number, userId: number): Promise<void> {
    const user = await this.db.getUserById(userId);
    if (!user) throw notFound('Utilisateur introuvable.');
    await this.db.setUserStatus(user.id, 'disabled');
    await this.db.revokeAllUserSessions(user.id);
    await recordAudit(this.db, {
      actor_user_id: actorUserId, action: 'user.disable', target: `user:${user.id}`,
      client_id: null, metadata: { email: user.email },
    });
  }

  private async requireClient(clientId: string): Promise<ClientRecord> {
    const client = await this.db.getClient(clientId);
    if (!client) throw notFound('Organisation introuvable.');
    return client;
  }

  private async membershipsIn(userId: number, clientId: string): Promise<MembershipRecord[]> {
    return (await this.db.listUserMemberships(userId, clientId))
      .filter((m) => m.user_id === userId && m.client_id === clientId);
  }

  /** Utilisateur ayant au moins une appartenance dans l'organisation, sinon 404 (rien n'est révélé). */
  private async requireMember(clientId: string, userId: number): Promise<MembershipRecord[]> {
    const user = await this.db.getUserById(userId);
    const memberships = user ? await this.membershipsIn(user.id, clientId) : [];
    if (!user || memberships.length === 0) throw notFound('Utilisateur introuvable.');
    return memberships;
  }

  private async requireInvitation(clientId: string, invitationId: number): Promise<InvitationRecord> {
    const inv = (await this.db.listInvitations(clientId))
      .find((i) => i.id === invitationId && i.client_id === clientId);
    if (!inv) throw notFound('Invitation introuvable.');
    return inv;
  }

  /** Forme valide et chaque entity_id désigne une entité active de l'organisation, sinon 400 chemin `grants`. */
  private async validateGrants(clientId: string, grants: readonly MembershipGrantRecord[]): Promise<MembershipGrantRecord[]> {
    if (!isWellFormedGrants(grants)) throw validationError([{ path: 'grants', message: INVALID_GRANTS }]);
    for (const g of grants) {
      if (g.entity_id === null) continue;
      const entity = await this.db.getEntity(clientId, g.entity_id);
      if (!entity || entity.client_id !== clientId || entity.status !== 'active') {
        throw validationError([{ path: 'grants', message: INVALID_ENTITY }]);
      }
    }
    return cleanGrants(grants);
  }

  /**
   * Refuse si l'utilisateur est aujourd'hui le seul admin compté de l'organisation.
   * Une organisation déjà sans admin (création par le super admin, avant la première
   * acceptation) n'est pas bloquée.
   */
  private async assertNotLastAdmin(clientId: string, userId: number): Promise<void> {
    const adminIds = new Set<number>();
    for (const m of await this.db.listOrgMemberships(clientId)) {
      if (m.client_id !== clientId || adminIds.has(m.user_id)) continue;
      if (m.entity_id !== null || m.role !== 'admin' || m.status !== 'active') continue;
      if (isCountedAdmin(m, await this.db.getUserById(m.user_id))) adminIds.add(m.user_id);
    }
    if (adminIds.has(userId) && adminIds.size === 1) throw conflict(LAST_ADMIN);
  }
}
