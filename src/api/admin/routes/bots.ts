import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { BotService } from '../../../core/services/bot-service.js';
import {
  CreateBotInput, UpdateBotInput, SetBotStatusInput, AssignNumberInput, UnassignNumberInput, SetAllowlistInput, ActivateBotInput,
} from '@wabagent/contracts';
import { activeAccess, activeClientId, requireAction } from '../../middleware/auth.js';
import { presentBotForViewer } from '../../../core/auth/contact-visibility.js';

export function botsRoutes(botService: BotService, wrap: (fn: RequestHandler) => RequestHandler): Router {
  const r = Router();
  // Lectures : la liste d'accès limité (numéros des contacts) est masquée pour un membre hors de l'entité de l'agent IA
  // (spec navigation 9.2). Les écritures ci-dessous vont à l'admin (`bots.configure`) et répondent en entier.
  r.get('/', requireAction('org.read'), wrap(async (req, res) => {
    const access = activeAccess(req);
    res.json((await botService.listBots(activeClientId(req))).map((bot) => presentBotForViewer(bot, access)));
  }));

  r.post('/', requireAction('bots.configure'), wrap(async (req, res) => {
    const clientId = activeClientId(req);
    const body = CreateBotInput.parse(req.body);
    res.status(201).json(await botService.createBot(clientId, req.auth!.userId, body));
  }));

  r.get('/:botId', requireAction('org.read'), wrap(async (req, res) => {
    res.json(presentBotForViewer(await botService.getBot(activeClientId(req), String(req.params['botId'])), activeAccess(req)));
  }));

  r.patch('/:botId', requireAction('bots.configure'), wrap(async (req, res) => {
    const clientId = activeClientId(req);
    const body = UpdateBotInput.parse(req.body);
    res.json(await botService.updateBot(clientId, String(req.params['botId']), req.auth!.userId, body));
  }));

  // Numéro branché (spec 2b §7.5) : un numéro inventorié de l'organisation, jamais saisi.
  r.put('/:botId/number', requireAction('bots.configure'), wrap(async (req, res) => {
    const clientId = activeClientId(req);
    const body = AssignNumberInput.parse(req.body);
    res.json(await botService.assignNumber(clientId, String(req.params['botId']), req.auth!.userId, body));
  }));

  // Débrancher : POST avec corps (`expected_number_id`) et non DELETE, dont le corps n'est pas garanti de traverser les
  // intermédiaires ; l'ancienne route DELETE sans corps n'existe plus (revue finale 2b-3 I-2).
  r.post('/:botId/number/unassign', requireAction('bots.configure'), wrap(async (req, res) => {
    const clientId = activeClientId(req);
    const body = UnassignNumberInput.parse(req.body);
    res.json(await botService.unassignNumber(clientId, String(req.params['botId']), req.auth!.userId, body));
  }));

  r.put('/:botId/status', requireAction('bots.configure'), wrap(async (req, res) => {
    const clientId = activeClientId(req);
    const body = SetBotStatusInput.parse(req.body);
    res.json(await botService.setStatus(clientId, String(req.params['botId']), req.auth!.userId, body.status));
  }));

  r.put('/:botId/allowlist', requireAction('bots.configure'), wrap(async (req, res) => {
    const clientId = activeClientId(req);
    const body = SetAllowlistInput.parse(req.body);
    res.json(await botService.setAllowlist(clientId, String(req.params['botId']), req.auth!.userId, body.entries));
  }));

  r.post('/:botId/activate', requireAction('bots.configure'), wrap(async (req, res) => {
    const clientId = activeClientId(req);
    const body = ActivateBotInput.parse(req.body);
    res.json(await botService.activate(clientId, String(req.params['botId']), req.auth!.userId, body));
  }));

  return r;
}
