import type { Database, InvitationRecord, UserRecord } from '../database/types.js';
import type { MembershipGrantRecord } from '../database/accounts-types.js';
import type { Mailer } from './mailer.js';
import { config } from '../config.js';
import { unauthorized } from '../../api/errors.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { signAccessToken, generateRefreshToken, hashRefreshToken } from './tokens.js';
import { isWellFormedGrants } from '../services/user-admin-service.js';

export interface PublicUser {
  id: number;
  email: string;
  role: string;
  client_id: string | null;
  status: string;
}

export interface OrganizationSummary {
  client_id: string;
  name: string;
}

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

const PLATFORM_ADMIN_ROLE = 'super_admin';
const INVALID_INVITATION = 'Invitation invalide ou expirée.';

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

  /** Utilisateur, rôle plateforme et organisations accessibles (super admin : toutes). */
  async me(userId: number): Promise<MeResult> {
    const user = await this.db.getUserById(userId);
    if (!user) throw unauthorized('Session invalide.');
    const organizations: OrganizationSummary[] = user.role === PLATFORM_ADMIN_ROLE
      ? (await this.db.listClients()).map((c) => ({ client_id: c.client_id, name: c.name }))
      : (await this.db.listUserOrganizations(user.id)).map((o) => ({ client_id: o.client_id, name: o.name }));
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
    const inv = await this.db.getInvitationByTokenHash(hashRefreshToken(token));
    if (!inv || inv.accepted_at || isExpired(inv.expires_at)) throw unauthorized(INVALID_INVITATION);
    const user = await this.db.getUserByEmail(inv.email);
    if (!user || user.status !== 'invited') throw unauthorized(INVALID_INVITATION);

    const pending = await this.db.listPendingInvitationsByEmail(inv.email);
    const accepted = pending.some((p) => p.id === inv.id) ? pending : [...pending, inv];

    await this.db.updateUserPassword(user.id, await hashPassword(password));
    await this.db.setUserStatus(user.id, 'active');

    for (const [clientId, grants] of await this.grantsByOrganization(accepted)) {
      // Une suspension déjà posée dans l'organisation (compte invité hérité) n'est pas levée par l'acceptation.
      const existing = await this.db.listUserMemberships(user.id, clientId);
      const status = existing.some((m) => m.client_id === clientId && m.status !== 'active') ? 'suspended' : 'active';
      await this.db.replaceMemberships(user.id, clientId, grants, status);
    }
    for (const p of accepted) await this.db.markInvitationAccepted(p.id);

    const fresh = await this.db.getUserById(user.id);
    if (!fresh) throw unauthorized(INVALID_INVITATION);
    return this.issueTokens(fresh);
  }

  /**
   * Grants à appliquer par organisation, invitation la plus récente gagnante. Une
   * organisation absente, une invitation sans grants (héritée) ou mal formée est ignorée ;
   * une grant vers une entité archivée ou d'une autre organisation depuis l'invitation est retirée.
   */
  private async grantsByOrganization(invitations: InvitationRecord[]): Promise<Map<string, MembershipGrantRecord[]>> {
    const latest = new Map<string, MembershipGrantRecord[]>();
    for (const inv of invitations) {
      if (inv.client_id === null || inv.grants === null || !isWellFormedGrants(inv.grants)) continue;
      latest.set(inv.client_id, inv.grants);
    }
    const result = new Map<string, MembershipGrantRecord[]>();
    for (const [clientId, grants] of latest) {
      if (!(await this.db.getClient(clientId))) continue;
      const kept: MembershipGrantRecord[] = [];
      for (const g of grants) {
        if (g.entity_id !== null) {
          const entity = await this.db.getEntity(clientId, g.entity_id);
          if (!entity || entity.client_id !== clientId || entity.status !== 'active') continue;
        }
        kept.push(g.read_only === true ? { entity_id: g.entity_id, role: g.role, read_only: true } : { entity_id: g.entity_id, role: g.role });
      }
      if (kept.length > 0) result.set(clientId, kept);
    }
    return result;
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
