import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { AdminService } from '../../../core/auth/admin-service.js';
import type { ConnectionsService } from '../../../core/services/connections-service.js';
import { CreateClientInput, UpdateClientInput, CreateInvitationInput, FieldMappingSchema } from '../../../contracts/index.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { notFound } from '../../errors.js';

export function clientsRoutes(adminService: AdminService, connectionsService: ConnectionsService, wrap: (fn: RequestHandler) => RequestHandler): Router {
  const r = Router();
  r.use(requireAuth, requireRole('super_admin'));

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

  r.get('/:clientId/invitations', wrap(async (req, res) => {
    res.json(await adminService.listInvitations(String(req.params['clientId'])));
  }));

  r.post('/:clientId/invitations', wrap(async (req, res) => {
    const body = CreateInvitationInput.parse(req.body);
    res.status(201).json(await adminService.createInvitation(String(req.params['clientId']), body.email, body.role));
  }));

  r.delete('/:clientId/invitations/:id', wrap(async (req, res) => {
    await adminService.revokeInvitation(String(req.params['clientId']), Number(req.params['id']));
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
