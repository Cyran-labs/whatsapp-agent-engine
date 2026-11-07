import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { ConnectionsService } from '../../../core/services/connections-service.js';
import { SetCredentialsInput, SetLlmInput, FieldMappingSchema } from '@wabagent/contracts';
import { activeClientId, requireAction } from '../../middleware/auth.js';
import { notFound } from '../../errors.js';

export function connectionsRoutes(svc: ConnectionsService, wrap: (fn: RequestHandler) => RequestHandler): Router {
  const r = Router({ mergeParams: true });

  r.put('/transport', requireAction('bots.configure'), wrap(async (req, res) => {
    const clientId = activeClientId(req);
    const body = SetCredentialsInput.parse(req.body);
    await svc.setTransport(clientId, String(req.params['botId']), req.auth!.userId, body.values);
    res.sendStatus(204);
  }));
  r.get('/transport', requireAction('bots.configure'), wrap(async (req, res) => {
    res.json(await svc.getTransportMasked(activeClientId(req), String(req.params['botId'])));
  }));
  r.post('/transport/validate', requireAction('bots.configure'), wrap(async (req, res) => {
    res.json(await svc.validateTransport(activeClientId(req), String(req.params['botId']), req.auth!.userId));
  }));

  r.put('/crm/:connector', requireAction('bots.configure'), wrap(async (req, res) => {
    const clientId = activeClientId(req);
    const body = SetCredentialsInput.parse(req.body);
    await svc.setCrm(clientId, String(req.params['botId']), req.auth!.userId, String(req.params['connector']), body.values);
    res.sendStatus(204);
  }));
  r.get('/crm/:connector', requireAction('bots.configure'), wrap(async (req, res) => {
    res.json(await svc.getCrmMasked(activeClientId(req), String(req.params['botId']), String(req.params['connector'])));
  }));
  r.post('/crm/:connector/validate', requireAction('bots.configure'), wrap(async (req, res) => {
    res.json(await svc.validateCrm(activeClientId(req), String(req.params['botId']), String(req.params['connector']), req.auth!.userId));
  }));

  r.put('/llm', requireAction('bots.configure'), wrap(async (req, res) => {
    const clientId = activeClientId(req);
    const body = SetLlmInput.parse(req.body);
    await svc.setLlm(clientId, String(req.params['botId']), req.auth!.userId, body);
    res.sendStatus(204);
  }));
  r.get('/llm', requireAction('bots.configure'), wrap(async (req, res) => {
    res.json(await svc.getLlm(activeClientId(req), String(req.params['botId'])));
  }));

  r.get('/mappings/:connector', requireAction('bots.configure'), wrap(async (req, res) => {
    const m = await svc.getMapping(activeClientId(req), String(req.params['botId']), String(req.params['connector']));
    if (!m) throw notFound('Mapping introuvable.');
    res.json(m);
  }));
  r.put('/mappings/:connector', requireAction('bots.configure'), wrap(async (req, res) => {
    const clientId = activeClientId(req);
    const mapping = FieldMappingSchema.parse(req.body);
    await svc.putMapping(clientId, String(req.params['botId']), String(req.params['connector']), req.auth!.userId, mapping);
    res.sendStatus(204);
  }));

  return r;
}
