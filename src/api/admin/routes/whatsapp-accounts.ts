import { Router } from 'express';
import type { Request, RequestHandler } from 'express';
import type { WhatsAppAccountService } from '../../../core/services/whatsapp-account-service.js';
import {
  CreateWhatsAppAccountInput, RenameWhatsAppAccountInput, ReplaceWhatsAppCredentialsInput, SetWhatsAppNumberTestFlagInput,
} from '@wabagent/contracts';
import { activeClientId, requireAction } from '../../middleware/auth.js';
import { notFound } from '../../errors.js';

/** Identifiant de chemin entier strictement positif ; sinon 404, comme un identifiant inconnu. */
function idParam(req: Request, name: string, message: string): number {
  const raw = String(req.params[name] ?? '');
  const id = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound(message);
  return id;
}

const accountId = (req: Request): number => idParam(req, 'accountId', 'Compte WhatsApp introuvable.');

/**
 * Comptes WhatsApp de l'organisation active (admin seulement). Montées derrière `requireAuth` et la résolution
 * de l'organisation : un compte d'une autre organisation répond 404 comme un identifiant inconnu.
 */
export function whatsappAccountsRoutes(svc: WhatsAppAccountService, wrap: (fn: RequestHandler) => RequestHandler): Router {
  const r = Router();
  const admin = requireAction('connections.manage');

  r.get('/', admin, wrap(async (req, res) => {
    res.json(await svc.list(activeClientId(req)));
  }));

  r.post('/', admin, wrap(async (req, res) => {
    const body = CreateWhatsAppAccountInput.parse(req.body);
    res.status(201).json(await svc.create(activeClientId(req), req.auth!.userId, body));
  }));

  r.get('/:accountId', admin, wrap(async (req, res) => {
    res.json(await svc.get(activeClientId(req), accountId(req)));
  }));

  r.patch('/:accountId', admin, wrap(async (req, res) => {
    const id = accountId(req);
    const body = RenameWhatsAppAccountInput.parse(req.body);
    res.json(await svc.rename(activeClientId(req), id, req.auth!.userId, body.name));
  }));

  r.put('/:accountId/credentials', admin, wrap(async (req, res) => {
    const id = accountId(req);
    const body = ReplaceWhatsAppCredentialsInput.parse(req.body);
    res.json(await svc.replaceCredentials(activeClientId(req), id, req.auth!.userId, body));
  }));

  r.post('/:accountId/verify', admin, wrap(async (req, res) => {
    res.json(await svc.verify(activeClientId(req), accountId(req), req.auth!.userId));
  }));

  r.post('/:accountId/refresh-numbers', admin, wrap(async (req, res) => {
    res.json(await svc.refreshNumbers(activeClientId(req), accountId(req), req.auth!.userId));
  }));

  r.post('/:accountId/disconnect', admin, wrap(async (req, res) => {
    await svc.disconnect(activeClientId(req), accountId(req), req.auth!.userId);
    res.sendStatus(204);
  }));

  r.patch('/:accountId/numbers/:numberId', admin, wrap(async (req, res) => {
    const id = accountId(req);
    const numberId = idParam(req, 'numberId', 'Numéro WhatsApp introuvable.');
    const body = SetWhatsAppNumberTestFlagInput.parse(req.body);
    res.json(await svc.setNumberTestFlag(activeClientId(req), id, numberId, req.auth!.userId, body.is_test));
  }));

  return r;
}
