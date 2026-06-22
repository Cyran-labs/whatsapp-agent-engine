import type { Database, UserRecord } from '../database/types.js';
import type { Mailer } from './mailer.js';
import { config } from '../config.js';
import { unauthorized } from '../../api/errors.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { signAccessToken, generateRefreshToken, hashRefreshToken } from './tokens.js';

export interface PublicUser {
  id: number;
  email: string;
  role: string;
  client_id: string | null;
  status: string;
}

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
    const access = await signAccessToken({ sub: String(user.id), role: user.role, client_id: user.client_id });
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

  async me(userId: number): Promise<PublicUser> {
    const user = await this.db.getUserById(userId);
    if (!user) throw unauthorized('Session invalide.');
    return toPublicUser(user);
  }

  async acceptInvite(token: string, password: string): Promise<AuthResult> {
    const inv = await this.db.getInvitationByTokenHash(hashRefreshToken(token));
    if (!inv || inv.accepted_at || isExpired(inv.expires_at)) throw unauthorized('Invitation invalide ou expirée.');
    const user = await this.db.getUserByEmail(inv.email);
    if (!user) throw unauthorized('Invitation invalide ou expirée.');
    await this.db.updateUserPassword(user.id, await hashPassword(password));
    await this.db.setUserStatus(user.id, 'active');
    await this.db.markInvitationAccepted(inv.id);
    const fresh = await this.db.getUserById(user.id);
    if (!fresh) throw unauthorized('Invitation invalide ou expirée.');
    return this.issueTokens(fresh);
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
