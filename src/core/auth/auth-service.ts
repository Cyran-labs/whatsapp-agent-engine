import type { Database, InvitationRecord, UserRecord } from '../database/types.js';
import type { MembershipGrantRecord } from '../database/accounts-types.js';
import type { Mailer } from './mailer.js';
import { config } from '../config.js';
import { unauthorized } from '../../api/errors.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { signAccessToken, generateRefreshToken, hashRefreshToken } from './tokens.js';
import { isWellFormedGrants } from '../services/user-admin-service.js';
import { recordAudit } from '../audit.js';
import { normalizeEmail } from './email.js';
import { PLATFORM_ADMIN_ROLE } from './permissions.js';

export interface PublicUser {
  id: number;
  email: string;
  role: string;
  client_id: string | null;
  status: string;
}

export type SummaryRole = 'admin' | 'super_manager' | 'manager' | 'advisor';

/** Organisation accessible, avec le rôle le plus élevé parmi les appartenances actives (R22). */
export interface OrganizationSummary {
  client_id: string;
  name: string;
  role: SummaryRole;
  read_only: boolean;
  /** Statut de l'organisation : présent seulement pour le super admin, qui les voit toutes. */
  status?: string;
}

/** Du plus élevé au plus faible. */
const ROLE_ORDER: readonly SummaryRole[] = ['admin', 'super_manager', 'manager', 'advisor'];

export type MeResult = PublicUser & { organizations: OrganizationSummary[] };

export interface AuthResult {
  access_token: string;
  refresh_token: string;
  user: PublicUser;
}

export interface AuthServiceDeps {
  db: Database;
  mailer: Mailer;
}

function toPublicUser(u: UserRecord): PublicUser {
  return { id: u.id, email: u.email, role: u.role, client_id: u.client_id, status: u.status };
}

function isExpired(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}

const INVALID_INVITATION = 'Invitation invalide ou expirée.';

/** Invitation retenue pour une organisation (la plus récente) et ses grants encore applicables. */
interface AppliedInvitation {
  invitationId: number;
  grants: MembershipGrantRecord[];
}

export class AuthService {
  private readonly db: Database;
  private readonly mailer: Mailer;

  constructor(deps: AuthServiceDeps) {
    this.db = deps.db;
    this.mailer = deps.mailer;
  }

  private async issueTokens(user: UserRecord): Promise<AuthResult> {
    const refresh = generateRefreshToken();
    const expiresAt = new Date(Date.now() + config.auth.refreshTtlDays * 86400_000).toISOString();
    await this.db.createAuthSession({ user_id: user.id, token_hash: hashRefreshToken(refresh), expires_at: expiresAt });
    const access = await signAccessToken({ sub: String(user.id), role: user.role });
    return { access_token: access, refresh_token: refresh, user: toPublicUser(user) };
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const user = await this.db.getUserByEmail(email);
    if (!user || !user.password_hash || user.status !== 'active') throw unauthorized('Identifiants invalides.');
    if (!(await verifyPassword(password, user.password_hash))) throw unauthorized('Identifiants invalides.');
    return this.issueTokens(user);
  }

  /**
   * Changement de mot de passe d'un compte connecté : vérifie le mot de passe actuel (401
   * sinon, sans rien révoquer), enregistre le nouveau, révoque toutes les sessions puis
   * réémet une session pour l'appelant. Compte non actif : 401.
   */
  async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<AuthResult> {
    const user = await this.db.getUserById(userId);
    if (!user || user.status !== 'active') throw unauthorized('Session invalide.');
    if (!user.password_hash || !(await verifyPassword(currentPassword, user.password_hash))) {
      throw unauthorized('Mot de passe actuel incorrect.');
    }
    await this.db.updateUserPassword(user.id, await hashPassword(newPassword));
    await this.db.revokeAllUserSessions(user.id);
    await recordAudit(this.db, {
      actor_user_id: user.id, action: 'user.password.change', target: `user:${user.id}`,
      client_id: null, metadata: null,
    });
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string): Promise<AuthResult> {
    const hash = hashRefreshToken(refreshToken);
    const session = await this.db.getAuthSessionByTokenHash(hash);
    if (!session) throw unauthorized('Session invalide.');
    if (session.revoked_at) {
      // Réutilisation d'un token déjà tourné → compromission probable : on coupe tout.
      await this.db.revokeAllUserSessions(session.user_id);
      throw unauthorized('Session invalide.');
    }
    if (isExpired(session.expires_at)) {
      await this.db.revokeAuthSession(session.id);
      throw unauthorized('Session expirée.');
    }
    const user = await this.db.getUserById(session.user_id);
    if (!user || user.status !== 'active') throw unauthorized('Session invalide.');
    await this.db.revokeAuthSession(session.id); // rotation
    return this.issueTokens(user);
  }

  async logout(refreshToken: string): Promise<void> {
    const session = await this.db.getAuthSessionByTokenHash(hashRefreshToken(refreshToken));
    if (session && !session.revoked_at) await this.db.revokeAuthSession(session.id);
  }

  /**
   * Utilisateur, rôle plateforme et organisations accessibles. Compte non actif : 401.
   * Super admin : toutes les organisations, chacune avec son statut. Autres comptes :
   * seulement les organisations actives où ils ont une appartenance active.
   */
  async me(userId: number): Promise<MeResult> {
    const user = await this.db.getUserById(userId);
    if (!user || user.status !== 'active') throw unauthorized('Session invalide.');
    const clients = await this.db.listClients();
    if (user.role === PLATFORM_ADMIN_ROLE) {
      const all = clients.map((c): OrganizationSummary => ({
        client_id: c.client_id, name: c.name, role: 'admin', read_only: false, status: c.status,
      }));
      return { ...toPublicUser(user), organizations: all };
    }
    const activeClients = new Set(clients.filter((c) => c.status === 'active').map((c) => c.client_id));
    const organizations: OrganizationSummary[] = [];
    for (const org of await this.db.listUserOrganizations(user.id)) {
      if (!activeClients.has(org.client_id)) continue;
      const active = (await this.db.listUserMemberships(user.id, org.client_id))
        .filter((m) => m.status === 'active' && m.user_id === user.id && m.client_id === org.client_id);
      const role = ROLE_ORDER.find((r) => active.some((m) => m.role === r));
      if (!role) continue;
      // Lecture seule : seulement sur une appartenance d'organisation super manager (invariant §4).
      const readOnly = active.some((m) => m.entity_id === null && m.role === 'super_manager' && m.read_only === true)
        && role === 'super_manager';
      organizations.push({ client_id: org.client_id, name: org.name, role, read_only: readOnly });
    }
    return { ...toPublicUser(user), organizations };
  }

  /**
   * Accepte une invitation : seul un compte encore « invited » peut l'être (un compte actif
   * ou désactivé ne peut pas être repris par un ancien lien). Le mot de passe est choisi
   * par l'invité, puis toutes ses invitations valides en attente sont appliquées dans
   * l'ordre de création (la possession de l'adresse est prouvée une fois) ; pour une même
   * organisation, la dernière l'emporte. Toutes sont ensuite marquées acceptées.
   */
  async acceptInvite(token: string, password: string): Promise<AuthResult> {
    const inv = await this.pendingInvitationByToken(token);
    const user = await this.db.getUserByEmail(inv.email);
    if (!user || user.status !== 'invited') throw unauthorized(INVALID_INVITATION);

    const pending = await this.db.listPendingInvitationsByEmail(inv.email);
    const accepted = pending.some((p) => p.id === inv.id) ? pending : [...pending, inv];

    await this.db.updateUserPassword(user.id, await hashPassword(password));
    await this.db.setUserStatus(user.id, 'active');

    for (const [clientId, { invitationId, grants }] of await this.grantsByOrganization(accepted)) {
      // Une suspension déjà posée dans l'organisation (compte invité hérité) n'est pas levée par l'acceptation.
      const existing = await this.db.listUserMemberships(user.id, clientId);
      const status = existing.some((m) => m.client_id === clientId && m.status !== 'active') ? 'suspended' : 'active';
      await this.db.replaceMemberships(user.id, clientId, grants, status);
      await recordAudit(this.db, {
        actor_user_id: user.id, action: 'user.invite.accept', target: `invitation:${invitationId}`,
        client_id: clientId, metadata: { grants },
      });
    }
    for (const p of accepted) await this.db.markInvitationAccepted(p.id);
    // Aucun lien restant (expiré, donc ressuscitable par « renvoyer ») pour les organisations appliquées (R26b).
    const appliedOrgs = new Set(accepted.map((p) => p.client_id).filter((c): c is string => c !== null));
    for (const clientId of appliedOrgs) await this.deleteOpenInvitations(inv.email, clientId);

    const fresh = await this.db.getUserById(user.id);
    if (!fresh) throw unauthorized(INVALID_INVITATION);
    return this.issueTokens(fresh);
  }

  /**
   * Grants à appliquer par organisation, invitation la plus récente gagnante. Une
   * organisation absente, une invitation sans grants (héritée) ou mal formée est ignorée ;
   * une grant vers une entité archivée ou d'une autre organisation depuis l'invitation est retirée.
   */
  private async grantsByOrganization(invitations: InvitationRecord[]): Promise<Map<string, AppliedInvitation>> {
    const latest = new Map<string, AppliedInvitation>();
    for (const inv of invitations) {
      if (inv.client_id === null || inv.grants === null || !isWellFormedGrants(inv.grants)) continue;
      latest.set(inv.client_id, { invitationId: inv.id, grants: inv.grants });
    }
    const result = new Map<string, AppliedInvitation>();
    for (const [clientId, { invitationId, grants }] of latest) {
      const kept = await this.usableGrants(clientId, grants);
      if (kept.length > 0) result.set(clientId, { invitationId, grants: kept });
    }
    return result;
  }

  /** Grants encore applicables : organisation existante, entités actives de cette organisation. */
  private async usableGrants(clientId: string, grants: MembershipGrantRecord[]): Promise<MembershipGrantRecord[]> {
    if (!(await this.db.getClient(clientId))) return [];
    const kept: MembershipGrantRecord[] = [];
    for (const g of grants) {
      if (g.entity_id !== null) {
        const entity = await this.db.getEntity(clientId, g.entity_id);
        if (!entity || entity.client_id !== clientId || entity.status !== 'active') continue;
      }
      kept.push(g.read_only === true ? { entity_id: g.entity_id, role: g.role, read_only: true } : { entity_id: g.entity_id, role: g.role });
    }
    return kept;
  }

  /**
   * Supprime les invitations non acceptées de cette adresse pour cette organisation
   * (choix : suppression plutôt que marquage « acceptée », pour que la liste des invitations
   * ne montre pas des acceptations qui n'ont pas eu lieu) (R26b).
   */
  private async deleteOpenInvitations(email: string, clientId: string): Promise<void> {
    const normalized = normalizeEmail(email);
    for (const other of await this.db.listInvitations(clientId)) {
      if (other.client_id === clientId && other.accepted_at === null && normalizeEmail(other.email) === normalized) {
        await this.db.deleteInvitation(other.id);
      }
    }
  }

  /** Invitation par jeton, non acceptée et non expirée ; sinon 401 générique. */
  private async pendingInvitationByToken(token: string): Promise<InvitationRecord> {
    const inv = await this.db.getInvitationByTokenHash(hashRefreshToken(token));
    if (!inv || inv.accepted_at || isExpired(inv.expires_at)) throw unauthorized(INVALID_INVITATION);
    return inv;
  }

  /**
   * Acceptation par un compte déjà actif, connecté (R24) : l'invitation doit viser l'adresse
   * de ce compte. Seule l'organisation de cette invitation est ajoutée. Toute anomalie
   * (jeton, autre compte, compte non actif, grants inutilisables) : 401 générique.
   */
  async acceptInvitationAsMember(userId: number, token: string): Promise<{ organizations: OrganizationSummary[] }> {
    const inv = await this.pendingInvitationByToken(token);
    const user = await this.db.getUserById(userId);
    if (!user || user.status !== 'active') throw unauthorized(INVALID_INVITATION);
    if (normalizeEmail(user.email) !== normalizeEmail(inv.email)) throw unauthorized(INVALID_INVITATION);
    if (inv.client_id === null || inv.grants === null || !isWellFormedGrants(inv.grants)) throw unauthorized(INVALID_INVITATION);
    const clientId = inv.client_id;
    const grants = await this.usableGrants(clientId, inv.grants);
    if (grants.length === 0) throw unauthorized(INVALID_INVITATION);

    // Déjà membre de l'organisation (active ou suspendue) : un lien restant ne doit ni écraser des
    // appartenances (rétrogradation) ni lever une suspension. Miroir de R19 ; rien n'est écrit (R26a).
    const existing = (await this.db.listUserMemberships(user.id, clientId)).filter((m) => m.client_id === clientId);
    if (existing.length > 0) throw unauthorized(INVALID_INVITATION);

    await this.db.replaceMemberships(user.id, clientId, grants, 'active');
    await this.db.markInvitationAccepted(inv.id);
    await this.deleteOpenInvitations(inv.email, clientId);
    await recordAudit(this.db, {
      actor_user_id: user.id, action: 'user.invite.accept', target: `invitation:${inv.id}`,
      client_id: clientId, metadata: { grants },
    });
    return { organizations: (await this.me(user.id)).organizations };
  }

  /**
   * Informations du lien avant acceptation (page publique). Le détenteur du jeton possède
   * l'adresse : lui indiquer si un compte existe est sans risque. Compte désactivé, absent
   * ou jeton invalide : 401 générique.
   */
  async invitationInfo(token: string): Promise<{ organization_name: string; requires_account_creation: boolean }> {
    const inv = await this.pendingInvitationByToken(token);
    if (inv.client_id === null) throw unauthorized(INVALID_INVITATION);
    const client = await this.db.getClient(inv.client_id);
    const user = await this.db.getUserByEmail(inv.email);
    if (!client || !user || (user.status !== 'invited' && user.status !== 'active')) throw unauthorized(INVALID_INVITATION);
    return { organization_name: client.name, requires_account_creation: user.status === 'invited' };
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.db.getUserByEmail(email);
    if (!user || user.status !== 'active') return; // silencieux : pas de fuite d'existence
    const token = generateRefreshToken();
    const expiresAt = new Date(Date.now() + config.auth.resetTtlHours * 3600_000).toISOString();
    await this.db.createPasswordReset({ user_id: user.id, token_hash: hashRefreshToken(token), expires_at: expiresAt });
    const link = `${config.auth.webOrigin}/reset-password?token=${token}`;
    try {
      await this.mailer.sendPasswordReset(user.email, link);
    } catch (err) {
      console.error('[AuthService] Échec envoi du mail de réinitialisation:', err);
    }
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const reset = await this.db.getPasswordResetByTokenHash(hashRefreshToken(token));
    if (!reset || reset.used_at || isExpired(reset.expires_at)) throw unauthorized('Lien de réinitialisation invalide ou expiré.');
    await this.db.updateUserPassword(reset.user_id, await hashPassword(password));
    await this.db.markPasswordResetUsed(reset.id);
    await this.db.revokeAllUserSessions(reset.user_id); // force re-login partout
  }
}
