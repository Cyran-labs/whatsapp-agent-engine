import { z } from 'zod';

export const LeadsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).optional(),
  rdv: z.coerce.boolean().optional(),
});
export type LeadsQuery = z.infer<typeof LeadsQuery>;
