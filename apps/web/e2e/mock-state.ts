/** État en mémoire du faux moteur : fixtures et remise à zéro (`POST /__reset`). */

export interface Account { id: number; email: string; password: string }
export interface Org { client_id: string; name: string }
export interface Entity { id: number; client_id: string; name: string; status: 'active' | 'archived' }
export interface Grant { entity_id: number | null; role: string; read_only: boolean }
export interface Membership extends Grant { user_id: number; client_id: string; status: 'active' | 'suspended' }
export interface Bot {
  client_id: string;
  bot_id: string;
  name: string;
  slug: string;
  status: string;
  languages: string[];
  default_language: string;
  whatsapp_number: { id: number; phone_e164: string } | null;
  system_prompt: Record<string, string>;
  entity_id: number;
}
export interface Invitation {
  id: number;
  client_id: string;
  email: string;
  token: string;
  grants: Grant[];
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export interface State {
  accounts: Account[];
  orgs: Org[];
  entities: Entity[];
  memberships: Membership[];
  bots: Bot[];
  invitations: Invitation[];
  /** Jetons de réinitialisation valides : jeton vers identifiant de compte. */
  resetTokens: Map<string, number>;
  /** Dernier lien de réinitialisation « envoyé par e-mail » (chemin relatif), lu via `GET /__last-reset-link`. */
  lastResetLink: string | null;
  nextIds: { account: number; entity: number; invitation: number; reset: number };
}

export const RESET_TOKEN = 'reset-ok';

function grant(entity_id: number | null, role: string, read_only = false): Grant {
  return { entity_id, role, read_only };
}

/**
 * c1 « Maison Lumière » : demo en admin, advisor en conseiller (entité 1).
 * c2 « Atelier Nord » : demo en conseiller (entité 2).
 * invite-new : compte neuf pour c1 ; invite-existing : advisor invité dans c2.
 * suspendu : seule appartenance (c2) suspendue, donc aucune organisation accessible.
 */
export function initialState(): State {
  return {
    accounts: [
      { id: 1, email: 'demo@wabagent.test', password: 'motdepasse12' },
      { id: 2, email: 'advisor@wabagent.test', password: 'motdepasse12' },
      { id: 3, email: 'suspendu@wabagent.test', password: 'motdepasse12' },
    ],
    orgs: [
      { client_id: 'c1', name: 'Maison Lumière' },
      { client_id: 'c2', name: 'Atelier Nord' },
    ],
    entities: [
      { id: 1, client_id: 'c1', name: 'Boutique Paris', status: 'active' },
      { id: 2, client_id: 'c2', name: 'Atelier', status: 'active' },
    ],
    memberships: [
      { user_id: 1, client_id: 'c1', status: 'active', ...grant(null, 'admin') },
      { user_id: 1, client_id: 'c2', status: 'active', ...grant(2, 'advisor') },
      { user_id: 2, client_id: 'c1', status: 'active', ...grant(1, 'advisor') },
      { user_id: 3, client_id: 'c2', status: 'suspended', ...grant(2, 'advisor') },
    ],
    bots: [
      { client_id: 'c1', bot_id: 'demo-1', name: 'Support technique', slug: 'support-technique', status: 'active', languages: ['fr'], default_language: 'fr', whatsapp_number: { id: 1, phone_e164: '+33612000047' }, system_prompt: { fr: 'Tu es un agent de support.' }, entity_id: 1 },
      { client_id: 'c2', bot_id: 'demo-2', name: 'Assistant atelier', slug: 'assistant-atelier', status: 'draft', languages: ['fr'], default_language: 'fr', whatsapp_number: null, system_prompt: { fr: 'Tu aides les clients.' }, entity_id: 2 },
    ],
    invitations: [
      { id: 1, client_id: 'c1', email: 'nouveau@wabagent.test', token: 'invite-new', grants: [grant(1, 'advisor')], expires_at: '2099-01-01T00:00:00.000Z', accepted_at: null, created_at: '2026-11-01T00:00:00.000Z' },
      { id: 2, client_id: 'c2', email: 'advisor@wabagent.test', token: 'invite-existing', grants: [grant(2, 'manager')], expires_at: '2099-01-01T00:00:00.000Z', accepted_at: null, created_at: '2026-11-01T00:00:00.000Z' },
    ],
    resetTokens: new Map([[RESET_TOKEN, 1]]),
    lastResetLink: null,
    nextIds: { account: 4, entity: 3, invitation: 3, reset: 1 },
  };
}
