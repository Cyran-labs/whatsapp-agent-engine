import { Router } from 'express';
import type { Request, RequestHandler } from 'express';
import type { ConnectionsService } from '../../../core/services/connections-service.js';
import { SetCredentialsInput, SetLlmInput, FieldMappingSchema } from '../../../contracts/index.js';
import { forbidden, notFound } from '../../errors.js';

function requireScopedClient(req: Request): string {
  if (!req.scopedClientId) throw forbidden('client_id requis (super_admin : préciser ?client_id).');
  return req.scopedClientId;
}

export function connectionsRoutes(svc: ConnectionsService, wrap: (fn: RequestHandler) => RequestHandler): Router {
  const r = Router({ mergeParams: true });

  r.put('/transport', wrap(async (req, res) => {
    const clientId = requireScopedClient(req);
    const body = SetCredentialsInput.parse(req.body);
    await svc.setTransport(clientId, String(req.params['botId']), req.auth!.userId, body.values);
    res.sendStatus(204);
  }));
  r.get('/transport', wrap(async (req, res) => {
    res.json(await svc.getTransportMasked(requireScopedClient(req), String(req.params['botId'])));
  }));
  r.post('/transport/validate', wrap(async (req, res) => {
    res.json(await svc.validateTransport(requireScopedClient(req), String(req.params['botId']), req.auth!.userId));
  }));

  r.put('/crm/:connector', wrap(async (req, res) => {
    const clientId = requireScopedClient(req);
    const body = SetCredentialsInput.parse(req.body);
    await svc.setCrm(clientId, String(req.params['botId']), req.auth!.userId, String(req.params['connector']), body.values);
    res.sendStatus(204);
  }));
  r.get('/crm/:connector', wrap(async (req, res) => {
    res.json(await svc.getCrmMasked(requireScopedClient(req), String(req.params['botId']), String(req.params['connector'])));
  }));
  r.post('/crm/:connector/validate', wrap(async (req, res) => {
    res.json(await svc.validateCrm(requireScopedClient(req), String(req.params['botId']), String(req.params['connector']), req.auth!.userId));
  }));

  r.put('/llm', wrap(async (req, res) => {
    const clientId = requireScopedClient(req);
    const body = SetLlmInput.parse(req.body);
    await svc.setLlm(clientId, String(req.params['botId']), req.auth!.userId, body);
    res.sendStatus(204);
  }));
  r.get('/llm', wrap(async (req, res) => {
    res.json(await svc.getLlm(requireScopedClient(req), String(req.params['botId'])));
  }));

  r.get('/mappings/:connector', wrap(async (req, res) => {
    const m = await svc.getMapping(requireScopedClient(req), String(req.params['botId']), String(req.params['connector']));
    if (!m) throw notFound('Mapping introuvable.');
    res.json(m);
  }));
  r.put('/mappings/:connector', wrap(async (req, res) => {
    const clientId = requireScopedClient(req);
    const mapping = FieldMappingSchema.parse(req.body);
    await svc.putMapping(clientId, String(req.params['botId']), String(req.params['connector']), req.auth!.userId, mapping);
    res.sendStatus(204);
  }));

  return r;
}
