import { z } from 'zod';

export const LeadsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).optional(),
  rdv: z.coerce.boolean().optional(),
});
export type LeadsQuery = z.infer<typeof LeadsQuery>;

const SINCE_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Instant ISO avec fuseau obligatoire (`Z` ou `+01:00`) : sans fuseau, l'heure serait lue différemment par chaque base. */
const SINCE_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
export const USAGE_SINCE_INVALID = 'Date de début invalide : instant ISO avec fuseau ou date AAAA-MM-JJ attendu.';

/** Instant UTC canonique d'un début de période, ou null si la valeur n'en est pas un. */
function sinceInstant(raw: string): string | null {
  if (!SINCE_DATE.test(raw) && !SINCE_INSTANT.test(raw)) return null;
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return null;
  const iso = new Date(at).toISOString();
  // Une date impossible (2026-02-30) est reportée par Date.parse au mois suivant : refusée.
  if (SINCE_DATE.test(raw) && iso.slice(0, 10) !== raw) return null;
  return iso;
}

/**
 * Requête `GET /bots/:id/usage` (revue finale M-10). `since` : début de la période, instant ISO avec fuseau (la page
 * Usage envoie le minuit de Paris, `2026-11-02T23:00:00.000Z`) ou date seule (`AAAA-MM-JJ`, minuit UTC, forme
 * acceptée avant ce lot). Rendu en instant ISO UTC canonique, que les deux pilotes comparent comme un instant à
 * `created_at`. Absent ou vide : aucun début (le moteur prend les 30 derniers jours).
 */
export const UsageQuery = z.object({
  since: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().transform((raw, ctx) => {
      const iso = sinceInstant(raw);
      if (iso === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: USAGE_SINCE_INVALID });
        return z.NEVER;
      }
      return iso;
    }).optional(),
  ),
});
export type UsageQuery = z.infer<typeof UsageQuery>;

export const SimulateInput = z.object({
  session_id: z.string().optional(),
  message: z.string().min(1, 'Écrivez un message.').max(4000, 'Le message fait 4000 caractères au plus.'),
  use_bot_config: z.boolean().default(false),
});
export type SimulateInput = z.infer<typeof SimulateInput>;
