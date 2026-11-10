import type { Database, EntityRecord } from '../database/types.js';
import type { CreateEntityInput, UpdateEntityInput } from '@wabagent/contracts';
import { recordAudit } from '../audit.js';
import { conflict, notFound } from '../../api/errors.js';
import { isUniqueViolation } from '../database/unique-violation.js';

export interface EntityServiceDeps { db: Database; }

export type EntitySummary = EntityRecord & { bots: number; members: number };

const DUPLICATE_NAME = 'Une entité porte déjà ce nom.';
const LAST_ACTIVE = "L'organisation doit garder au moins une entité active.";
const STILL_USED = "Déplacez d'abord les agents IA et les membres de cette entité.";

export class EntityService {
  private readonly db: Database;
  constructor(deps: EntityServiceDeps) { this.db = deps.db; }

  /** Entités actives par défaut, avec le nombre d'agents IA et de membres actifs. */
  async list(clientId: string, opts?: { includeArchived?: boolean }): Promise<EntitySummary[]> {
    const entities = await this.db.listEntities(clientId, { includeArchived: opts?.includeArchived === true });
    return Promise.all(entities.map(async (entity) => {
      const usage = await this.db.countEntityUsage(clientId, entity.id);
      return { ...entity, bots: usage.bots, members: usage.activeMembers };
    }));
  }

  async create(clientId: string, actorUserId: number | null, input: CreateEntityInput): Promise<EntityRecord> {
    await this.assertNameFree(clientId, input.name, null);
    let entity: EntityRecord;
    try {
      entity = await this.db.createEntity(clientId, input.name);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict(DUPLICATE_NAME, 'entity.duplicate_name');
      throw err;
    }
    await recordAudit(this.db, {
      actor_user_id: actorUserId, action: 'entity.create', target: `entity:${clientId}/${entity.id}`,
      client_id: clientId, metadata: { name: entity.name },
    });
    return entity;
  }

  async update(clientId: string, id: number, actorUserId: number | null, patch: UpdateEntityInput): Promise<EntityRecord> {
    // 404 d'abord : une entité d'une autre organisation n'est jamais révélée.
    const existing = await this.db.getEntity(clientId, id);
    if (!existing) throw notFound('Entité introuvable.', 'entity.not_found');

    const nextStatus = patch.status ?? existing.status;
    const nextName = patch.name ?? existing.name;

    if (patch.status === 'archived' && existing.status === 'active') {
      const active = await this.db.listEntities(clientId);
      if (active.length <= 1) throw conflict(LAST_ACTIVE, 'entity.last_active');
      const usage = await this.db.countEntityUsage(clientId, id);
      if (usage.bots > 0 || usage.activeMembers > 0) throw conflict(STILL_USED, 'entity.in_use');
    }
    if (nextStatus === 'active' && (nextName !== existing.name || existing.status !== 'active')) {
      await this.assertNameFree(clientId, nextName, id);
    }

    try {
      await this.db.updateEntity(clientId, id, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict(DUPLICATE_NAME, 'entity.duplicate_name');
      throw err;
    }
    const updated = await this.db.getEntity(clientId, id);
    if (!updated) throw notFound('Entité introuvable.', 'entity.not_found');
    await recordAudit(this.db, {
      actor_user_id: actorUserId, action: 'entity.update', target: `entity:${clientId}/${id}`,
      client_id: clientId, metadata: { ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.status !== undefined ? { status: patch.status } : {}) },
    });
    return updated;
  }

  private async assertNameFree(clientId: string, name: string, exceptId: number | null): Promise<void> {
    const active = await this.db.listEntities(clientId);
    if (active.some((e) => e.id !== exceptId && e.name === name)) throw conflict(DUPLICATE_NAME, 'entity.duplicate_name');
  }
}
