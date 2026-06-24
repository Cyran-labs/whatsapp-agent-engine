import { Router } from 'express';
import type { Request, RequestHandler } from 'express';
import type { BotService } from '../../../core/services/bot-service.js';
import { CreateBotInput, UpdateBotInput, SetNumbersInput, SetBotStatusInput } from '@wabagent/contracts';
import { requireAuth, scopeToClient } from '../../middleware/auth.js';
import { forbidden } from '../../errors.js';

function requireScopedClient(req: Request): string {
  if (!req.scopedClientId) throw forbidden('client_id requis (super_admin : préciser ?client_id).');
  return req.scopedClientId;
}

export function botsRoutes(botService: BotService, wrap: (fn: RequestHandler) => RequestHandler): Router {
  const r = Router();
  r.use(requireAuth, scopeToClient);

  r.get('/', wrap(async (req, res) => {
    res.json(await botService.listBots(requireScopedClient(req)));
  }));

  r.post('/', wrap(async (req, res) => {
    const clientId = requireScopedClient(req);
    const body = CreateBotInput.parse(req.body);
    res.status(201).json(await botService.createBot(clientId, req.auth!.userId, body));
  }));

  r.get('/:botId', wrap(async (req, res) => {
    res.json(await botService.getBot(requireScopedClient(req), String(req.params['botId'])));
  }));

  r.patch('/:botId', wrap(async (req, res) => {
    const clientId = requireScopedClient(req);
    const body = UpdateBotInput.parse(req.body);
    res.json(await botService.updateBot(clientId, String(req.params['botId']), req.auth!.userId, body));
  }));

  r.put('/:botId/numbers', wrap(async (req, res) => {
    const clientId = requireScopedClient(req);
    const body = SetNumbersInput.parse(req.body);
    res.json(await botService.setNumbers(clientId, String(req.params['botId']), req.auth!.userId, body.numbers));
  }));

  r.put('/:botId/status', wrap(async (req, res) => {
    const clientId = requireScopedClient(req);
    const body = SetBotStatusInput.parse(req.body);
    res.json(await botService.setStatus(clientId, String(req.params['botId']), req.auth!.userId, body.status));
  }));

  return r;
}
