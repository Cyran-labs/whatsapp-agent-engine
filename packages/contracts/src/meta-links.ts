// Liens vers les pages de Meta et lecture des identifiants d'une adresse Meta collée (lot R2a, spec §5.1, §5.4, §8).
// Source unique du web : le guide du raccordement et les liens « Ouvrir dans WhatsApp Manager » en dérivent.

/** Identifiant Meta (portefeuille, WABA) : chiffres seuls, comme `waba_id` des identifiants Meta. */
const META_ID = /^\d{5,25}$/;
const META_BUSINESS_HOST = 'business.facebook.com';

export interface MetaIds {
  business_id: string | null;
  asset_id: string | null;
}

function metaId(value: string | null): string | null {
  return value !== null && META_ID.test(value) ? value : null;
}

/**
 * Lit l'ID du portefeuille (`business_id`) et l'ID de la WABA (`asset_id`) d'une saisie de l'admin. Des chiffres seuls
 * (espaces retirés) sont lus comme `business_id`. Une adresse n'est lue que si son hôte est exactement
 * `business.facebook.com` (https ou http), et seulement ses paramètres `business_id` et `asset_id` : la première
 * valeur d'un paramètre en double, jamais le fragment. Rend `null` pour une entrée non reconnue (aucun des deux lu).
 */
export function extractMetaIds(input: string): MetaIds | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  if (/^[\d\s]+$/.test(trimmed)) {
    const digits = trimmed.replace(/\s+/g, '');
    return META_ID.test(digits) ? { business_id: digits, asset_id: null } : null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.hostname !== META_BUSINESS_HOST || url.username !== '' || url.password !== '') return null;
  const ids: MetaIds = {
    business_id: metaId(url.searchParams.get('business_id')),
    asset_id: metaId(url.searchParams.get('asset_id')),
  };
  return ids.business_id === null && ids.asset_id === null ? null : ids;
}

/** Lien vers une page de Meta : `precise` vrai seulement s'il ouvre la page du bon portefeuille (et de la bonne WABA). */
export interface MetaLink {
  url: string;
  precise: boolean;
}

export interface MetaLinks {
  /** Paramètres, Informations sur l'entreprise : là où se lit l'ID du portefeuille. */
  businessInfo: MetaLink;
  /**
   * WhatsApp Manager du portefeuille, sans WABA choisie : l'administrateur y choisit le compte, et l'adresse de la page
   * porte alors son WABA ID (`asset_id`). Recette R2a du 18 nov. 2026 (RF-2) : remplace la page des Paramètres « Comptes
   * WhatsApp », qui n'affiche jamais le WABA ID et y sélectionne un autre identifiant.
   */
  managerHome: MetaLink;
  /** Paramètres, Utilisateurs système. */
  systemUsers: MetaLink;
  /** WhatsApp Manager, Numéros de téléphone d'une WABA. */
  phoneNumbers: MetaLink;
  /** WhatsApp Manager, vue d'ensemble d'une WABA. */
  managerOverview: MetaLink;
  /** Apps de Meta for Developers : jamais précis. */
  developerApps: MetaLink;
}

// Adresses génériques d'aujourd'hui (guide R1 `connect-guide-meta.tsx`, `whatsAppManagerUrl` et `metaAppUrl(null)` du web) :
// sans portefeuille, Meta ouvre le dernier portefeuille et la dernière WABA utilisés.
const GENERIC_SETTINGS = 'https://business.facebook.com/latest/settings';
const GENERIC_PHONE_NUMBERS = 'https://business.facebook.com/wa/manage/phone-numbers/';
const GENERIC_MANAGER = 'https://business.facebook.com/wa/manage/home/';
const DEVELOPER_APPS = 'https://developers.facebook.com/apps/';

/**
 * Liens vers les pages de Meta pour un portefeuille et une WABA. Formes précises : celles relevées par François au registre
 * R1 (13 nov. 2026, `progress.md` lignes 169 à 174) et en recette R2a (18 nov. 2026, `docs/debug/2026-11-18-recette-r2a.md`). Sans portefeuille, ou sans WABA pour les pages de WhatsApp Manager
 * qui l'exigent, l'adresse générique d'aujourd'hui avec `precise: false`. Un identifiant qui n'est pas fait de 5 à 25
 * chiffres est traité comme absent : il n'est jamais recopié dans une adresse.
 */
export function metaLinks(ids: { business_id: string | null; waba_id: string | null }): MetaLinks {
  const business = metaId(ids.business_id);
  const waba = metaId(ids.waba_id);
  const both = business !== null && waba !== null ? `business_id=${business}&asset_id=${waba}` : null;
  return {
    businessInfo: business !== null
      ? { url: `https://business.facebook.com/latest/settings/business_info?business_id=${business}`, precise: true }
      : { url: GENERIC_SETTINGS, precise: false },
    managerHome: business !== null
      ? { url: `https://business.facebook.com/latest/whatsapp_manager/overview/?business_id=${business}`, precise: true }
      : { url: GENERIC_MANAGER, precise: false },
    // Forme confirmée par François dans les vraies pages (recette R2a du 18 nov. 2026, RF-1). Meta y ajoute lui-même
    // `selected_user_id`, propre à chaque utilisateur système et inconnu de WABAGENT : il n'est jamais recopié ici.
    systemUsers: business !== null
      ? { url: `https://business.facebook.com/latest/settings/system_users?business_id=${business}`, precise: true }
      : { url: GENERIC_SETTINGS, precise: false },
    phoneNumbers: both !== null
      ? { url: `https://business.facebook.com/latest/whatsapp_manager/phone_numbers/?${both}`, precise: true }
      : { url: waba !== null ? `${GENERIC_PHONE_NUMBERS}?waba_id=${waba}` : GENERIC_PHONE_NUMBERS, precise: false },
    managerOverview: both !== null
      ? { url: `https://business.facebook.com/latest/whatsapp_manager/overview/?${both}`, precise: true }
      : { url: GENERIC_MANAGER, precise: false },
    developerApps: { url: DEVELOPER_APPS, precise: false },
  };
}
