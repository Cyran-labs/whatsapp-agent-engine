import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { SettingsService } from '../../../core/services/settings-service.js';
import { UpdateOrganizationSettingsInput } from '@wabagent/contracts';
import { activeClientId, requireAction } from '../../middleware/auth.js';

export function settingsRoutes(settingsService: SettingsService, wrap: (fn: RequestHandler) => RequestHandler): Router {
  const r = Router();

  r.get('/', requireAction('org.read'), wrap(async (req, res) => {
    res.json(await settingsService.get(activeClientId(req)));
  }));

  r.patch('/', requireAction('settings.write'), wrap(async (req, res) => {
    const body = UpdateOrganizationSettingsInput.parse(req.body);
    res.json(await settingsService.update(activeClientId(req), req.auth!.userId, body));
  }));

  return r;
}
