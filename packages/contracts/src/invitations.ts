import { z } from 'zod';

const email = z.string().trim().email().transform((s) => s.toLowerCase());

/**
 * Ancien schéma d'invitation par rôle plateforme. Conservé jusqu'à la tâche 8
 * (route clients.ts), qui le supprimera au profit de CreateInvitationInput (accounts.ts).
 */
export const LegacyCreateInvitationInput = z.object({
  email,
  role: z.enum(['super_admin', 'client_admin']),
});
export type LegacyCreateInvitationInput = z.infer<typeof LegacyCreateInvitationInput>;
