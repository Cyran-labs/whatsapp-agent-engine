import { z } from 'zod';

const clientId = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/, 'client_id: minuscules, chiffres, tirets.');

export const CreateClientInput = z.object({
  client_id: clientId,
  name: z.string().min(1),
  status: z.enum(['active', 'suspended']).default('active'),
});
export type CreateClientInput = z.infer<typeof CreateClientInput>;

export const UpdateClientInput = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(['active', 'suspended']).optional(),
});
export type UpdateClientInput = z.infer<typeof UpdateClientInput>;
