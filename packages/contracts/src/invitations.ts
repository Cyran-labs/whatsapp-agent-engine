import { z } from 'zod';

const email = z.string().trim().email().transform((s) => s.toLowerCase());

export const CreateInvitationInput = z.object({
  email,
  role: z.enum(['super_admin', 'client_admin']),
});
export type CreateInvitationInput = z.infer<typeof CreateInvitationInput>;
