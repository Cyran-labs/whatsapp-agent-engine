import type { Database } from '../database/types.js';
import { OrganizationSettings, type UpdateOrganizationSettingsInput } from '@wabagent/contracts';
import { recordAudit } from '../audit.js';
import { validationError } from '../../api/errors.js';

export interface SettingsServiceDeps { db: Database; }

const VISIBILITY_UNAVAILABLE = "Ce mode de visibilité n'est pas encore disponible.";

export class SettingsService {
  private readonly db: Database;
  constructor(deps: SettingsServiceDeps) { this.db = deps.db; }

  /**
   * Réglages de l'organisation. Un JSON stocké invalide (ancien ou modifié à la main) ne
   * fait jamais échouer la lecture : chaque champ invalide retombe sur son défaut.
   */
  async get(clientId: string): Promise<OrganizationSettings> {
    const stored = await this.db.getClientSettings(clientId);
    const resolved: Record<string, unknown> = {};
    const invalid: string[] = [];
    for (const key of Object.keys(OrganizationSettings.shape) as Array<keyof OrganizationSettings>) {
      const value = stored[key];
      if (value === undefined) continue;
      if (OrganizationSettings.shape[key].safeParse(value).success) resolved[key] = value;
      else invalid.push(key);
    }
    if (invalid.length > 0) {
      console.warn(`[Settings] Réglages invalides pour ${clientId} (défauts appliqués) : ${invalid.join(', ')}`);
    }
    return OrganizationSettings.parse(resolved);
  }

  async update(clientId: string, actorUserId: number, patch: UpdateOrganizationSettingsInput): Promise<OrganizationSettings> {
    if (patch.visibility !== undefined && patch.visibility !== 'all') {
      throw validationError([{ path: 'visibility', message: VISIBILITY_UNAVAILABLE }]);
    }
    const current = await this.get(clientId);
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const next = OrganizationSettings.parse({ ...current, ...defined });
    await this.db.setClientSettings(clientId, next);
    await recordAudit(this.db, {
      actor_user_id: actorUserId, action: 'settings.update', target: `settings:${clientId}`,
      client_id: clientId, metadata: defined,
    });
    return next;
  }
}
