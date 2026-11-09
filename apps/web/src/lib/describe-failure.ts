import type { MutationFailure } from './api-fetch';

/**
 * Nature d'un refus, qui décide de son emplacement (audit §5.1) : `field` sous le champ, `business` dans la fenêtre,
 * la ligne ou le panneau de l'action, `server` et `network` à l'endroit de l'action avec le texte contextuel de
 * l'écran (et la référence pour `server`), `session`, `forbidden`, `not_found` et `rate_limited` lus de même.
 */
export type FailureKind = 'field' | 'business' | 'session' | 'forbidden' | 'not_found' | 'rate_limited' | 'server' | 'network';

export interface DescribedFailure {
  kind: FailureKind;
  /** Texte à afficher : jamais une clé brute. */
  message: string;
  /** Message par champ de l'écran (`opts.fields`), le premier détail d'un champ l'emporte. */
  fieldErrors: Record<string, string>;
  /** Référence de la requête, seulement pour une panne serveur (à citer au support). */
  reference: string | null;
}

export interface DescribeFailureOptions {
  /** Texte contextuel de l'écran (« Enregistrement impossible pour le moment. Réessayez. »), déjà traduit. */
  fallback: string;
  locale: 'fr' | 'en';
  /** Traducteur de la racine des messages (`useTranslations()`) : les clés lues sont `errors.reasons.*` et `errors.generic.*`. */
  t: (key: string) => string;
  /** `t.has` du même traducteur. */
  has: (key: string) => boolean;
  /** Champs affichés par l'écran : seuls les détails dont le `path` en fait partie vont dans `fieldErrors`. */
  fields?: readonly string[];
}

/** Forme d'une clé de `ERROR_REASONS` (`<domaine>.<cas>`) : un groupe de messages (`member`) n'est pas un texte. */
const REASON_SHAPE = /^[a-z_]+\.[a-z_]+$/;

function kindOfStatus(status: number): FailureKind {
  if (status === 401) return 'session';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  return 'business';
}

/** Traduction de la clé du refus, null si le web ne la connaît pas. */
function translatedReason(reason: string | null, opts: DescribeFailureOptions): string | null {
  if (reason === null || !REASON_SHAPE.test(reason)) return null;
  const key = `errors.reasons.${reason}`;
  return opts.has(key) ? opts.t(key) : null;
}

/**
 * Lecture uniforme d'un refus de `sendMutation` (audit §5.4). Fonction pure : l'écran passe son traducteur et sa langue.
 * - réseau (statut 0) : `network`, texte contextuel ;
 * - 5xx : `server`, texte contextuel et référence de la requête (audit R-14), jamais le message technique ;
 * - 429 : `rate_limited`, texte `errors.generic.rateLimited` ;
 * - sinon : la traduction de la clé du refus si le web la connaît ; à défaut, en français le texte du moteur, en
 *   anglais le texte contextuel (point d'attention 2 : jamais une clé brute, jamais du français dans l'interface
 *   anglaise) ; les détails sur un champ de l'écran vont dans `fieldErrors` et font un refus `field`.
 * Un détail sans message, ou au même texte que le refus, prend le texte retenu pour le refus ; un détail au texte
 * propre le garde en français et prend le texte du refus en anglais.
 */
export function describeFailure(failure: MutationFailure, opts: DescribeFailureOptions): DescribedFailure {
  if (failure.status === 0) return { kind: 'network', message: opts.fallback, fieldErrors: {}, reference: null };
  if (failure.status >= 500) return { kind: 'server', message: opts.fallback, fieldErrors: {}, reference: failure.requestId };
  if (failure.status === 429) {
    return { kind: 'rate_limited', message: opts.t('errors.generic.rateLimited'), fieldErrors: {}, reference: null };
  }

  const message = translatedReason(failure.reason, opts) ?? (opts.locale === 'fr' ? failure.error : opts.fallback);
  const fields = new Set(opts.fields ?? []);
  const byField = new Map<string, string>();
  for (const detail of failure.details) {
    if (!fields.has(detail.path) || byField.has(detail.path)) continue;
    const own = detail.message !== undefined && detail.message !== failure.error ? detail.message : null;
    byField.set(detail.path, own !== null && opts.locale === 'fr' ? own : message);
  }
  const kind = byField.size > 0 ? 'field' : kindOfStatus(failure.status);
  return { kind, message, fieldErrors: Object.fromEntries(byField), reference: null };
}
