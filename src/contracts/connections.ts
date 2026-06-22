import { z } from 'zod';

export const SetCredentialsInput = z.object({ values: z.record(z.string()) });
export type SetCredentialsInput = z.infer<typeof SetCredentialsInput>;

export const SetLlmInput = z.object({
  mode: z.enum(['byo', 'platform']),
  model: z.string().optional(),
  api_key: z.string().optional(),
});
export type SetLlmInput = z.infer<typeof SetLlmInput>;

const RuleSchema = z.object({ source: z.string(), target: z.string(), transform: z.string().optional() });
const ValuesSchema = z.object({ on_create: z.record(z.string()).optional(), on_update: z.record(z.string()).optional() });

export const FieldMappingSchema = z.object({
  version: z.number(),
  connector: z.string(),
  target_object: z.string(),
  client_id: z.string(),
  field_mapping: z.array(RuleSchema),
  fixed_values: ValuesSchema.optional(),
  default_values: ValuesSchema.optional(),
  fallback: z.object({ target: z.string(), concat_template: z.string().optional(), include_unmapped: z.boolean().optional() }).optional(),
  deduplication: z.object({ primary_key: z.string(), fallback_keys: z.array(z.string()).optional() }).optional(),
});
export type FieldMappingSchema = z.infer<typeof FieldMappingSchema>;
