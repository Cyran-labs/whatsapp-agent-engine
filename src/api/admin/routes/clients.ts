import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { Database } from '../../../core/database/types.js';
import type { AdminService } from '../../../core/auth/admin-service.js';
import type { UserAdminService } from '../../../core/services/user-admin-service.js';
import type { ConnectionsService } from '../../../core/services/connections-service.js';
import { CreateClientInput, UpdateClientInput, CreateInvitationInput, FieldMappingSchema } from '@wabagent/contracts';
import { requireAuth, createRequirePlatformAdmin } from '../../middleware/auth.js';
import { notFound } from '../../errors.js';

export function clientsRoutes(
  db: Database,
  adminService: AdminService,
  userAdminService: UserAdminService,
  connectionsService: ConnectionsService,
  wrap: (fn: RequestHandler) => RequestHandler,
): Router {
  const r = Router();
  r.use(requireAuth, createRequirePlatformAdmin(db));

  r.get('/', wrap(async (_req, res) => {
    res.json(await adminService.listClients());
  }));

  r.post('/', wrap(async (req, res) => {
    const body = CreateClientInput.parse(req.body);
    res.status(201).json(await adminService.createClient(body));
  }));

  r.patch('/:clientId', wrap(async (req, res) => {
    const body = UpdateClientInput.parse(req.body);
    res.json(await adminService.updateClient(String(req.params['clientId']), body));
  }));

  // Invitations d'une organisation par le super admin (premier admin notamment) : même logique
  // que l'admin d'organisation, aucune réponse ne porte de jeton ni de lien.
  r.get('/:clientId/invitations', wrap(async (req, res) => {
    const clientId = String(req.params['clientId']);
    if (!(await db.getClient(clientId))) throw notFound('Organisation introuvable.');
    res.json(await userAdminService.listInvitations(clientId));
  }));

  r.post('/:clientId/invitations', wrap(async (req, res) => {
    const body = CreateInvitationInput.parse(req.body);
    res.status(201).json(await userAdminService.invite(String(req.params['clientId']), req.auth!.userId, body.email, body.grants));
  }));

  r.delete('/:clientId/invitations/:id', wrap(async (req, res) => {
    const id = Number(req.params['id']);
    if (!Number.isSafeInteger(id) || id <= 0) throw notFound('Invitation introuvable.', 'invitation.not_found');
    await userAdminService.revokeInvitation(String(req.params['clientId']), id, req.auth!.userId);
    res.sendStatus(204);
  }));

  r.get('/:clientId/mappings/:connector', wrap(async (req, res) => {
    const m = await connectionsService.getClientMapping(String(req.params['clientId']), String(req.params['connector']));
    if (!m) throw notFound('Mapping client introuvable.');
    res.json(m);
  }));

  r.put('/:clientId/mappings/:connector', wrap(async (req, res) => {
    const mapping = FieldMappingSchema.parse(req.body);
    await connectionsService.putClientMapping(String(req.params['clientId']), String(req.params['connector']), req.auth!.userId, mapping);
    res.sendStatus(204);
  }));

  return r;
}
