import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { Database } from '../../../core/database/types.js';
import type { UserAdminService } from '../../../core/services/user-admin-service.js';
import { requireAuth, createRequirePlatformAdmin } from '../../middleware/auth.js';
import { notFound } from '../../errors.js';

/** Opérations plateforme, réservées au super admin (rôle et statut relus en base à chaque requête). */
export function platformRoutes(
  db: Database,
  userAdminService: UserAdminService,
  wrap: (fn: RequestHandler) => RequestHandler,
): Router {
  const r = Router();
  r.use(requireAuth, createRequirePlatformAdmin(db));

  r.post('/users/:userId/disable', wrap(async (req, res) => {
    const userId = Number(req.params['userId']);
    if (!Number.isSafeInteger(userId) || userId <= 0) throw notFound('Utilisateur introuvable.', 'member.not_found');
    await userAdminService.disableGlobally(req.auth!.userId, userId);
    res.sendStatus(204);
  }));

  return r;
}
