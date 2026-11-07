import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { EntityService } from '../../../core/services/entity-service.js';
import { CreateEntityInput, UpdateEntityInput } from '@wabagent/contracts';
import { activeClientId, requireAction } from '../../middleware/auth.js';
import { notFound } from '../../errors.js';

export function entitiesRoutes(entityService: EntityService, wrap: (fn: RequestHandler) => RequestHandler): Router {
  const r = Router();

  r.get('/', requireAction('org.read'), wrap(async (req, res) => {
    const includeArchived = req.query['include_archived'] === 'true';
    res.json(await entityService.list(activeClientId(req), { includeArchived }));
  }));

  r.post('/', requireAction('entities.manage'), wrap(async (req, res) => {
    const body = CreateEntityInput.parse(req.body);
    res.status(201).json(await entityService.create(activeClientId(req), req.auth!.userId, body));
  }));

  r.patch('/:id', requireAction('entities.manage'), wrap(async (req, res) => {
    const id = Number(req.params['id']);
    if (!Number.isSafeInteger(id) || id <= 0) throw notFound('Entité introuvable.');
    const body = UpdateEntityInput.parse(req.body);
    res.json(await entityService.update(activeClientId(req), id, req.auth!.userId, body));
  }));

  return r;
}
