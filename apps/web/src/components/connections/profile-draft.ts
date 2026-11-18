// Saisie du profil WhatsApp d'un numéro (lot R2a, spec R2a §5.2, §13.4) : règles pures, sans appel réseau. Les limites
// et la forme de l'e-mail viennent des contrats, source unique du moteur et du web.
import {
  BUSINESS_PROFILE_LIMITS, UpdateWhatsAppBusinessProfileInput, WHATSAPP_VERTICALS, isProfileWebsite, profileWebsiteToSend,
  type WhatsAppBusinessProfileView, type WhatsAppVertical,
} from '@wabagent/contracts';

/** Champs texte du profil, dans l'ordre de l'écran (maquette 04). */
export const PROFILE_TEXT_FIELDS = ['about', 'description', 'address', 'email'] as const;
export type ProfileTextField = (typeof PROFILE_TEXT_FIELDS)[number];

/** Champs de l'écran qui peuvent porter un refus du moteur (`error.details[].path`). */
export const PROFILE_FIELD_PATHS = ['about', 'description', 'address', 'email', 'vertical', 'websites', 'websites.0', 'websites.1'] as const;
export type ProfileFieldPath = (typeof PROFILE_FIELD_PATHS)[number];

export interface ProfileDraft {
  about: string;
  description: string;
  address: string;
  email: string;
  /** Une ou deux saisies ; une saisie vide n'est pas un site. */
  websites: string[];
  /** Valeur de Meta, ou '' quand le secteur lu n'est pas dans la liste (« Non renseigné »). */
  vertical: string;
}

/** Erreur locale d'un champ : clé de `connections.profile.errors`, avec la limite pour `tooLong`. */
export type DraftError = { key: 'aboutEmpty' } | { key: 'emailInvalid' } | { key: 'websiteInvalid' } | { key: 'tooLong'; max: number };

/** Nombre de caractères comme chez Meta : points de code (un emoji compte pour 1), jamais des unités UTF-16. */
export function codePoints(value: string): number {
  return [...value].length;
}

/**
 * Longueur d'un site telle que la limite la mesure : l'adresse envoyée, `https://` compris pour un site saisi sans schéma
 * (recette R2a, RC-2). Compteur de l'écran et refus local la lisent ici (relecture des retouches, M-2). Saisie vide : 0.
 */
export function websiteLength(value: string): number {
  return value.trim() === '' ? 0 : codePoints(profileWebsiteToSend(value));
}

export function isVertical(value: string): value is WhatsAppVertical {
  return WHATSAPP_VERTICALS.some((v) => v === value);
}

export function draftOf(profile: WhatsAppBusinessProfileView): ProfileDraft {
  return {
    about: profile.about,
    description: profile.description,
    address: profile.address,
    email: profile.email,
    websites: profile.websites.length > 0 ? profile.websites.slice(0, BUSINESS_PROFILE_LIMITS.websites) : [''],
    vertical: isVertical(profile.vertical) ? profile.vertical : '',
  };
}

/** Sites saisis, rognés, sans les saisies vides. */
export function sitesOf(draft: ProfileDraft): string[] {
  return draft.websites.map((w) => w.trim()).filter((w) => w.length > 0);
}

/**
 * Champs modifiés par rapport à la version lue chez Meta (`baseline`), seuls envoyés (spec R2a §5.2, point 5) : un champ
 * texte vidé est envoyé vide, des sites tous retirés sont envoyés en liste vide. Le secteur n'est envoyé que s'il est
 * choisi dans la liste (il ne se vide pas).
 */
export function changedFields(baseline: ProfileDraft, draft: ProfileDraft): UpdateWhatsAppBusinessProfileInput {
  const patch: UpdateWhatsAppBusinessProfileInput = {};
  for (const field of PROFILE_TEXT_FIELDS) {
    const value = draft[field].trim();
    if (value !== baseline[field].trim()) patch[field] = value;
  }
  const sites = sitesOf(draft);
  if (JSON.stringify(sites) !== JSON.stringify(sitesOf(baseline))) patch.websites = sites;
  if (draft.vertical !== baseline.vertical && isVertical(draft.vertical)) patch.vertical = draft.vertical;
  return patch;
}

const EMAIL = UpdateWhatsAppBusinessProfileInput.shape.email;

/**
 * Refus locaux, avant tout envoi (Ruling R-5 et R-6) : infos jamais vides, longueurs des contrats, forme de l'e-mail
 * et des sites (audit P-24) contrôlée par les contrats. Les messages sont ceux de l'écran (traduits), pas ceux du contrat.
 */
export function draftErrors(draft: ProfileDraft): Partial<Record<ProfileFieldPath, DraftError>> {
  const errors: Partial<Record<ProfileFieldPath, DraftError>> = {};
  for (const field of PROFILE_TEXT_FIELDS) {
    const max = BUSINESS_PROFILE_LIMITS[field];
    if (codePoints(draft[field].trim()) > max) errors[field] = { key: 'tooLong', max };
  }
  if (draft.about.trim().length === 0) errors.about = { key: 'aboutEmpty' };
  const email = draft.email.trim();
  if (errors.email === undefined && email !== '' && !EMAIL.safeParse(email).success) errors.email = { key: 'emailInvalid' };
  draft.websites.forEach((site, index) => {
    const max = BUSINESS_PROFILE_LIMITS.website;
    const path = index === 0 ? 'websites.0' : 'websites.1';
    const value = site.trim();
    // Recette R2a (RC-2) : longueur de l'adresse envoyée (https:// ajouté sans schéma), comme dans les contrats.
    if (websiteLength(value) > max) errors[path] = { key: 'tooLong', max };
    // Audit P-24 : forme d'adresse des contrats ; une saisie vide n'est pas un site (elle n'est pas envoyée).
    else if (value !== '' && !isProfileWebsite(value)) errors[path] = { key: 'websiteInvalid' };
  });
  return errors;
}

/**
 * Refus locaux qui bloquent l'envoi (revue finale M-e) : ceux des champs envoyés seulement (présents dans le patch,
 * `changedFields`). Un champ non touché tel que Meta le rend (infos vides, site de plus de 256 caractères) n'est pas
 * envoyé et ne bloque donc pas l'enregistrement des autres. Les sites sont envoyés en liste entière : modifiés, tous leurs
 * refus bloquent. Chemins dans l'ordre de l'écran.
 */
export function blockingErrors(baseline: ProfileDraft, draft: ProfileDraft): ProfileFieldPath[] {
  const sent = new Set<string>(Object.keys(changedFields(baseline, draft)));
  const errors = draftErrors(draft);
  return PROFILE_FIELD_PATHS.filter((path) => errors[path] !== undefined && sent.has(path.split('.')[0] ?? path));
}
