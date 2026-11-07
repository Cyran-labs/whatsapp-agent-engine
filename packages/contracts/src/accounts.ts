import { z } from 'zod';

const email = z.string().trim().email().transform((s) => s.toLowerCase());

/** Rôles de périmètre organisation (entity_id null). */
export const OrgRole = z.enum(['admin', 'super_manager']);
export type OrgRole = z.infer<typeof OrgRole>;

/** Rôles de périmètre entité. */
export const EntityRole = z.enum(['manager', 'advisor']);
export type EntityRole = z.infer<typeof EntityRole>;

const OrgGrant = z.object({
  entity_id: z.null(),
  role: OrgRole,
  read_only: z.boolean().optional(),
}).superRefine((g, ctx) => {
  if (g.read_only === true && g.role !== 'super_manager') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['read_only'],
      message: 'La lecture seule n\'est permise que pour un super manager.',
    });
  }
});

const EntityGrant = z.object({
  entity_id: z.number().int().positive(),
  role: EntityRole,
});

export const MembershipGrant = z.union([OrgGrant, EntityGrant]);
export type MembershipGrant = z.infer<typeof MembershipGrant>;

/** Soit exactement une grant d'organisation, soit des grants d'entité aux entity_id distincts, jamais un mélange. */
export const Grants = z.array(MembershipGrant).min(1, 'Au moins un rôle est requis.').superRefine((grants, ctx) => {
  const orgGrants = grants.filter((g) => g.entity_id === null);
  const entityGrants = grants.filter((g) => g.entity_id !== null);
  if (orgGrants.length > 0 && entityGrants.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Un rôle d\'organisation ne peut pas être combiné avec des rôles d\'entité.' });
    return;
  }
  if (orgGrants.length > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Un seul rôle d\'organisation est permis.' });
    return;
  }
  const seen = new Set<number>();
  for (const g of entityGrants) {
    if (g.entity_id === null) continue;
    if (seen.has(g.entity_id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Une seule grant par entité est permise.' });
      return;
    }
    seen.add(g.entity_id);
  }
});
export type Grants = z.infer<typeof Grants>;

export const CreateInvitationInput = z.object({ email, grants: Grants });
export type CreateInvitationInput = z.infer<typeof CreateInvitationInput>;

export const SetMembershipsInput = z.object({ grants: Grants });
export type SetMembershipsInput = z.infer<typeof SetMembershipsInput>;

export const SetMemberStatusInput = z.object({ status: z.enum(['active', 'suspended']) });
export type SetMemberStatusInput = z.infer<typeof SetMemberStatusInput>;

const entityName = z.string().trim().min(1, 'Le nom est requis.').max(80, 'Le nom ne peut pas dépasser 80 caractères.');

export const CreateEntityInput = z.object({ name: entityName });
export type CreateEntityInput = z.infer<typeof CreateEntityInput>;

export const UpdateEntityInput = z.object({
  name: entityName.optional(),
  status: z.enum(['active', 'archived']).optional(),
});
export type UpdateEntityInput = z.infer<typeof UpdateEntityInput>;

export const OrganizationSettings = z.object({
  visibility: z.enum(['all', 'entities', 'own_and_pool']).default('all'),
  pool_self_claim: z.boolean().default(true),
  reassign: z.enum(['managers', 'everyone']).default('managers'),
  transfer: z.enum(['managers', 'everyone']).default('managers'),
  takeover: z.enum(['owner', 'entity_members']).default('owner'),
});
export type OrganizationSettings = z.infer<typeof OrganizationSettings>;

/** Mise à jour partielle : aucun défaut réappliqué sur les champs absents. */
export const UpdateOrganizationSettingsInput = z.object({
  visibility: OrganizationSettings.shape.visibility.removeDefault().optional(),
  pool_self_claim: OrganizationSettings.shape.pool_self_claim.removeDefault().optional(),
  reassign: OrganizationSettings.shape.reassign.removeDefault().optional(),
  transfer: OrganizationSettings.shape.transfer.removeDefault().optional(),
  takeover: OrganizationSettings.shape.takeover.removeDefault().optional(),
});
export type UpdateOrganizationSettingsInput = z.infer<typeof UpdateOrganizationSettingsInput>;
