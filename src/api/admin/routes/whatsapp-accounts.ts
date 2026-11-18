import express, { Router } from 'express';
import type { Request, RequestHandler } from 'express';
import { ADMIN_INVENTORY, type WhatsAppAccountService } from '../../../core/services/whatsapp-account-service.js';
import { photoInvalid, type WhatsAppNumberProfileService } from '../../../core/services/whatsapp-number-profile-service.js';
import {
  ApplyDisplayNameInput, CreateWhatsAppAccountInput, PROFILE_PHOTO_MAX_BYTES, PROFILE_PHOTO_TYPES, RenameWhatsAppAccountInput,
  ReplaceWhatsAppCredentialsInput, RequestDisplayNameInput, SetWhatsAppNumberTestFlagInput, UpdateWhatsAppBusinessProfileInput,
  type ErrorReason,
} from '@wabagent/contracts';
import { activeClientId, requireAction } from '../../middleware/auth.js';
import { notFound } from '../../errors.js';

/** Identifiant de chemin entier strictement positif ; sinon 404, comme un identifiant inconnu. */
function idParam(req: Request, name: string, message: string, reason: ErrorReason): number {
  const raw = String(req.params[name] ?? '');
  const id = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound(message, reason);
  return id;
}

const accountId = (req: Request): number => idParam(req, 'accountId', 'Compte WhatsApp introuvable.', 'whatsapp_account.not_found');
const numberIdOf = (req: Request): number => idParam(req, 'numberId', 'Numéro WhatsApp introuvable.', 'whatsapp_account.number_not_found');

/**
 * Corps binaire de la photo du profil (lot R2a, spec R2a §6.2), sur cette route seulement : la limite JSON des autres
 * routes (`express.json` du routeur) ne change pas. Corps au-delà de la limite ou illisible : `photo_invalid`, jamais
 * l'erreur de l'analyseur (qui porte le corps). Un autre type n'est pas lu ; le contenu est contrôlé par le service.
 */
const rawPhoto = express.raw({ type: [...PROFILE_PHOTO_TYPES], limit: PROFILE_PHOTO_MAX_BYTES });
const photoBody: RequestHandler = (req, res, next) => {
  rawPhoto(req, res, (err?: unknown) => { next(err === undefined || err === null ? undefined : photoInvalid()); });
};

/**
 * Comptes WhatsApp de l'organisation active (admin seulement). Montées derrière `requireAuth` et la résolution
 * de l'organisation : un compte d'une autre organisation répond 404 comme un identifiant inconnu.
 */
export function whatsappAccountsRoutes(
  svc: WhatsAppAccountService, profiles: WhatsAppNumberProfileService, wrap: (fn: RequestHandler) => RequestHandler,
): Router {
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

  // Clé d'URL d'un compte CM.com : cette route est la seule lecture qui la sert (revue 2b-3 M-2). Compte Meta : 404 (lot R1).
  r.get('/:accountId/webhook', admin, wrap(async (req, res) => {
    res.json(await svc.getWebhook(activeClientId(req), accountId(req)));
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
    res.json(await svc.refreshNumbers(activeClientId(req), accountId(req), req.auth!.userId, ADMIN_INVENTORY));
  }));

  // « Faire pointer vers WABAGENT » (spec R1 §5.4) : le webhook de l'app Meta est remplacé par l'adresse de ce compte.
  r.post('/:accountId/app-webhook', admin, wrap(async (req, res) => {
    res.json(await svc.pointAppWebhook(activeClientId(req), accountId(req), req.auth!.userId));
  }));

  r.post('/:accountId/disconnect', admin, wrap(async (req, res) => {
    // Lot R1 (spec R1 §5.5) : bilan du nettoyage chez Meta, `WhatsAppAccountDisconnected`.
    res.json(await svc.disconnect(activeClientId(req), accountId(req), req.auth!.userId));
  }));

  r.patch('/:accountId/numbers/:numberId', admin, wrap(async (req, res) => {
    const id = accountId(req);
    const numberId = numberIdOf(req);
    const body = SetWhatsAppNumberTestFlagInput.parse(req.body);
    res.json(await svc.setNumberTestFlag(activeClientId(req), id, numberId, req.auth!.userId, body.is_test));
  }));

  // Lot R2a, spec R2a §6.4 : profil WhatsApp, photo et nom d'affichage d'un numéro. Les identifiants de chemin sont lus
  // avant le corps ; le service retrouve le compte puis le numéro (404) avant tout appel à Meta. Aucun corps n'est
  // journalisé : le profil porte adresse et e-mail, l'application du nom le code de vérification en deux étapes.
  r.get('/:accountId/numbers/:numberId/profile', admin, wrap(async (req, res) => {
    const id = accountId(req);
    res.json(await profiles.getProfile(activeClientId(req), id, numberIdOf(req)));
  }));

  r.put('/:accountId/numbers/:numberId/profile', admin, wrap(async (req, res) => {
    const id = accountId(req);
    const numberId = numberIdOf(req);
    const profilePatch = UpdateWhatsAppBusinessProfileInput.parse(req.body);
    res.json(await profiles.updateProfile(activeClientId(req), id, numberId, req.auth!.userId, profilePatch));
  }));

  r.post('/:accountId/numbers/:numberId/profile/photo', admin, photoBody, wrap(async (req, res) => {
    const id = accountId(req);
    const numberId = numberIdOf(req);
    const bytes: unknown = req.body;
    const type = req.is([...PROFILE_PHOTO_TYPES]);
    if (!Buffer.isBuffer(bytes) || typeof type !== 'string') throw photoInvalid();
    res.json(await profiles.updatePhoto(activeClientId(req), id, numberId, req.auth!.userId, { bytes, type }));
  }));

  r.post('/:accountId/numbers/:numberId/display-name', admin, wrap(async (req, res) => {
    const id = accountId(req);
    const numberId = numberIdOf(req);
    const body = RequestDisplayNameInput.parse(req.body);
    res.json(await profiles.requestDisplayName(activeClientId(req), id, numberId, req.auth!.userId, body.new_display_name));
  }));

  r.post('/:accountId/numbers/:numberId/display-name/apply', admin, wrap(async (req, res) => {
    const id = accountId(req);
    const numberId = numberIdOf(req);
    const { pin } = ApplyDisplayNameInput.parse(req.body);
    res.json(await profiles.applyDisplayName(activeClientId(req), id, numberId, req.auth!.userId, pin));
  }));

  return r;
}
