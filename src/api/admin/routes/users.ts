import { Router } from 'express';
import type { Request, RequestHandler } from 'express';
import type { UserAdminService } from '../../../core/services/user-admin-service.js';
import { CreateInvitationInput, SetMembershipsInput, SetMemberStatusInput, type ErrorReason } from '@wabagent/contracts';
import { activeClientId, requireAction } from '../../middleware/auth.js';
import { notFound } from '../../errors.js';

/** Identifiant de chemin entier positif, sinon 404 (jamais d'erreur de format révélatrice). */
function idParam(req: Request, name: string, message: string, reason: ErrorReason): number {
  const id = Number(req.params[name]);
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound(message, reason);
  return id;
}

/** Membres de l'organisation active. À monter sous `/users`, après la résolution de l'organisation. */
export function usersRoutes(userAdminService: UserAdminService, wrap: (fn: RequestHandler) => RequestHandler): Router {
  const r = Router();
  r.use(requireAction('users.manage'));

  r.get('/', wrap(async (req, res) => {
    res.json(await userAdminService.listMembers(activeClientId(req)));
  }));

  r.put('/:userId/memberships', wrap(async (req, res) => {
    const userId = idParam(req, 'userId', 'Utilisateur introuvable.', 'member.not_found');
    const body = SetMembershipsInput.parse(req.body);
    await userAdminService.setMemberships(activeClientId(req), req.auth!.userId, userId, body.grants);
    res.sendStatus(204);
  }));

  r.patch('/:userId', wrap(async (req, res) => {
    const userId = idParam(req, 'userId', 'Utilisateur introuvable.', 'member.not_found');
    const body = SetMemberStatusInput.parse(req.body);
    await userAdminService.setStatus(activeClientId(req), req.auth!.userId, userId, body.status);
    res.sendStatus(204);
  }));

  return r;
}

/** Invitations de l'organisation active. À monter sous `/invitations`. Aucune réponse ne porte de jeton ni de lien. */
export function invitationsRoutes(userAdminService: UserAdminService, wrap: (fn: RequestHandler) => RequestHandler): Router {
  const r = Router();
  r.use(requireAction('users.manage'));

  r.get('/', wrap(async (req, res) => {
    res.json(await userAdminService.listInvitations(activeClientId(req)));
  }));

  r.post('/', wrap(async (req, res) => {
    const body = CreateInvitationInput.parse(req.body);
    res.status(201).json(await userAdminService.invite(activeClientId(req), req.auth!.userId, body.email, body.grants));
  }));

  r.post('/:id/resend', wrap(async (req, res) => {
    const id = idParam(req, 'id', 'Invitation introuvable.', 'invitation.not_found');
    await userAdminService.resendInvitation(activeClientId(req), req.auth!.userId, id);
    res.sendStatus(204);
  }));

  r.delete('/:id', wrap(async (req, res) => {
    const id = idParam(req, 'id', 'Invitation introuvable.', 'invitation.not_found');
    await userAdminService.revokeInvitation(activeClientId(req), id, req.auth!.userId);
    res.sendStatus(204);
  }));

  return r;
}
