import { z } from 'zod';

/**
 * Message d'une issue Zod à montrer à l'utilisateur. Un message écrit dans les contrats (en français) est gardé tel
 * quel ; seul le message par défaut de Zod (anglais) est remplacé par un texte français selon le type de l'issue.
 */
export function zodIssueToFrench(issue: z.ZodIssue): string {
  // Le message par défaut d'une issue est ce que `defaultErrorMap` produit pour elle ; tout autre texte a été écrit.
  const zodDefault = z.defaultErrorMap(issue, { defaultError: issue.message, data: undefined }).message;
  if (issue.message !== zodDefault) return issue.message;
  switch (issue.code) {
    case 'too_small':
      return issue.type === 'string' ? 'Valeur trop courte.' : 'Valeur invalide.';
    case 'too_big':
      return issue.type === 'string' ? 'Valeur trop longue.' : 'Valeur invalide.';
    case 'invalid_string':
      return 'Format invalide.';
    case 'invalid_type':
      return 'Valeur manquante ou invalide.';
    default:
      return 'Valeur invalide.';
  }
}
