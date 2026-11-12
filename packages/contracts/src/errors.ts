export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL'
  | 'WA_VALIDATION_FAILED'
  | 'CRM_VALIDATION_FAILED';

/**
 * Clé stable d'un refus métier affiché sur un écran (`error.reason`), de la forme `<domaine>.<cas>`. Le texte français
 * du moteur reste dans `message` ; le web traduit par clé et ne garde ce texte qu'en repli (audit R-15).
 * Une clé ne distingue jamais un objet « tenu par une autre organisation » d'un objet « introuvable » : les deux
 * refus portent le même texte et la même clé (isolation entre organisations).
 */
export const ERROR_REASONS = [
  // Session (T1, T3)
  'session.expired',
  'session.invalid',
  'session.organization_suspended',
  // Authentification et invitations (A1, A2, A4, A7)
  'auth.invalid_credentials',
  'auth.current_password_incorrect',
  'auth.invalid_invitation',
  'auth.invalid_reset_link',
  // Membres et invitations (U1 à U7)
  'member.already_member',
  'member.last_admin',
  'member.not_found',
  'member.invalid_grants',
  'member.invalid_entity',
  'invitation.not_invitable',
  'invitation.already_accepted',
  'invitation.not_found',
  // Entités (N1, N2, N3, N5)
  'entity.duplicate_name',
  'entity.last_active',
  'entity.in_use',
  'entity.not_found',
  // Nom d'entité vide ou trop long (audit des décisions B2)
  'entity.name_invalid',
  // Comptes WhatsApp (W1 à W13)
  'whatsapp_account.masked_value',
  'whatsapp_account.already_connected',
  'whatsapp_account.cannot_connect',
  'whatsapp_account.other_provider_account',
  'whatsapp_account.disconnected',
  'whatsapp_account.secrets_unreadable',
  'whatsapp_account.verification_failed',
  'whatsapp_account.app_unreadable',
  'whatsapp_account.listing_failed',
  // Lecture des numéros : jeton refusé (le compte passe en erreur) ou panne passagère du fournisseur (audit décisions B7)
  'whatsapp_account.listing_token_invalid',
  'whatsapp_account.listing_unavailable',
  'whatsapp_account.empty_inventory',
  'whatsapp_account.in_use',
  'whatsapp_account.not_found',
  'whatsapp_account.number_not_found',
  // Raccordement automatique (lot R1) : webhook inscrit chez Meta par le moteur
  'whatsapp_account.public_url_missing',
  'whatsapp_account.webhook_unreachable',
  'whatsapp_account.webhook_unconfirmed',
  'whatsapp_account.webhook_url_too_long',
  'whatsapp_account.app_webhook_failed',
  // Changement de statut d'un agent IA (B1) : une clé par `TransitionRefusal`
  'transition.no_number',
  'transition.number_removed',
  'transition.account_not_connected',
  'transition.empty_allowlist',
  'transition.not_from_draft',
  'transition.invalid_transition',
  // Branchement d'un numéro (B3, B4, B5)
  'assign.holder_changed',
  'assign.number_removed',
  'assign.not_found',
  // Liste d'accès limité (B6, B7)
  'allowlist.invalid_entry',
  'allowlist.too_many',
  // Agents IA (B9 à B12, B14)
  'bot.entity_required',
  'bot.entity_unavailable',
  'bot.default_language_missing',
  'bot.id_taken',
  'bot.not_found',
] as const;
export type ErrorReason = (typeof ERROR_REASONS)[number];

export interface ApiErrorDetail {
  path: string;
  message: string;
  /**
   * Texte renvoyé tel quel par le fournisseur (message d'erreur de Meta ou de CM.com, masqué et borné), pour un contrôle
   * de vérification refusé ; jamais un message écrit par le moteur.
   */
  provider_text?: string;
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: ApiErrorDetail[];
    /** Clé stable du refus métier, absente des erreurs techniques et des règles de forme (Zod). */
    reason?: ErrorReason;
    request_id: string;
  };
}
