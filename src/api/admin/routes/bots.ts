import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { BotService } from '../../../core/services/bot-service.js';
import { CreateBotInput, UpdateBotInput, SetNumbersInput, SetBotStatusInput } from '@wabagent/contracts';
import { activeClientId, requireAction } from '../../middleware/auth.js';

export function botsRoutes(botService: BotService, wrap: (fn: RequestHandler) => RequestHandler): Router {
  const r = Router();
  r.get('/', requireAction('org.read'), wrap(async (req, res) => {
    res.json(await botService.listBots(activeClientId(req)));
  }));

  r.post('/', requireAction('bots.configure'), wrap(async (req, res) => {
    const clientId = activeClientId(req);
    const body = CreateBotInput.parse(req.body);
    res.status(201).json(await botService.createBot(clientId, req.auth!.userId, body));
  }));

  r.get('/:botId', requireAction('org.read'), wrap(async (req, res) => {
    res.json(await botService.getBot(activeClientId(req), String(req.params['botId'])));
  }));

  r.patch('/:botId', requireAction('bots.configure'), wrap(async (req, res) => {
    const clientId = activeClientId(req);
    const body = UpdateBotInput.parse(req.body);
    res.json(await botService.updateBot(clientId, String(req.params['botId']), req.auth!.userId, body));
  }));

  r.put('/:botId/numbers', requireAction('bots.configure'), wrap(async (req, res) => {
    const clientId = activeClientId(req);
    const body = SetNumbersInput.parse(req.body);
    res.json(await botService.setNumbers(clientId, String(req.params['botId']), req.auth!.userId, body.numbers));
  }));

  r.put('/:botId/status', requireAction('bots.configure'), wrap(async (req, res) => {
    const clientId = activeClientId(req);
    const body = SetBotStatusInput.parse(req.body);
    res.json(await botService.setStatus(clientId, String(req.params['botId']), req.auth!.userId, body.status));
  }));

  return r;
}
