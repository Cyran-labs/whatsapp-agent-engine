import { z } from 'zod';

const email = z.string().trim().email().transform((s) => s.toLowerCase());
const password = z.string().min(10, 'Le mot de passe doit faire au moins 10 caractères.');

// Login: password uses min(1), NOT the shared min(10) validator. Intentional:
// the login form must accept any existing password (incl. legacy/short ones) and
// never reveal policy hints (anti-enumeration). The min(10) policy applies only at
// password creation (accept-invite / reset). Do not "fix" this to min(10).
export const LoginInput = z.object({ email, password: z.string().min(1) });
export type LoginInput = z.infer<typeof LoginInput>;

export const RefreshInput = z.object({ refresh_token: z.string().min(1) });
export type RefreshInput = z.infer<typeof RefreshInput>;

export const LogoutInput = z.object({ refresh_token: z.string().min(1) });
export type LogoutInput = z.infer<typeof LogoutInput>;

export const AcceptInviteInput = z.object({ token: z.string().min(1), password });
export type AcceptInviteInput = z.infer<typeof AcceptInviteInput>;

/** Acceptation d'une invitation par un compte déjà actif et connecté (aucun mot de passe à créer). */
export const AcceptInvitationAsMemberInput = z.object({ token: z.string().min(1) });
export type AcceptInvitationAsMemberInput = z.infer<typeof AcceptInvitationAsMemberInput>;

/** Informations affichées avant acceptation (page publique du lien). */
export const InvitationInfoInput = z.object({ token: z.string().min(1) });
export type InvitationInfoInput = z.infer<typeof InvitationInfoInput>;

export const ForgotPasswordInput = z.object({ email });
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordInput>;

export const ResetPasswordInput = z.object({ token: z.string().min(1), password });
export type ResetPasswordInput = z.infer<typeof ResetPasswordInput>;

/** Changement de mot de passe sous session : le mot de passe actuel accepte tout (comme le login), le nouveau suit la règle à 10 caractères. */
export const ChangePasswordInput = z.object({ current_password: z.string().min(1), new_password: password });
export type ChangePasswordInput = z.infer<typeof ChangePasswordInput>;

/** Rôle proposé par une invitation, tel que montré avant acceptation. */
export type GrantsSummary =
  | { scope: 'organization'; role: 'admin' | 'super_manager'; read_only: boolean }
  | { scope: 'entities'; entities: Array<{ entity_name: string; role: 'manager' | 'advisor' }> };

/** Réponse de `POST /auth/invitations/info` (page publique du lien). */
export interface InvitationInfo {
  organization_name: string;
  requires_account_creation: boolean;
  /** Adresse masquée (première lettre de la partie locale, puis des points). */
  email_hint: string;
  grants_summary: GrantsSummary;
}
