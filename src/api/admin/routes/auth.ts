import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { AuthService } from '../../../core/auth/auth-service.js';
import {
  LoginInput, RefreshInput, LogoutInput, AcceptInviteInput, ForgotPasswordInput, ResetPasswordInput,
  AcceptInvitationAsMemberInput, InvitationInfoInput, ChangePasswordInput,
} from '@wabagent/contracts';
import { requireAuth } from '../../middleware/auth.js';
import { createRateLimiter } from '../../middleware/rate-limit.js';
import { unauthorized } from '../../errors.js';

export function authRoutes(authService: AuthService, wrap: (fn: RequestHandler) => RequestHandler): Router {
  const r = Router();
  const loginLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });
  const forgotLimiter = createRateLimiter({ windowMs: 60_000, max: 5 });
  const changePasswordLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });
  const invitationInfoLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });

  r.post('/login', loginLimiter, wrap(async (req, res) => {
    const body = LoginInput.parse(req.body);
    res.json(await authService.login(body.email, body.password));
  }));

  r.post('/refresh', wrap(async (req, res) => {
    const body = RefreshInput.parse(req.body);
    res.json(await authService.refresh(body.refresh_token));
  }));

  r.post('/logout', wrap(async (req, res) => {
    const body = LogoutInput.parse(req.body);
    await authService.logout(body.refresh_token);
    res.sendStatus(204);
  }));

  r.post('/accept-invite', wrap(async (req, res) => {
    const body = AcceptInviteInput.parse(req.body);
    res.json(await authService.acceptInvite(body.token, body.password));
  }));

  // Compte déjà actif et connecté : accepte une invitation reçue par e-mail (R24).
  r.post('/invitations/accept', requireAuth, wrap(async (req, res) => {
    if (!req.auth) throw unauthorized();
    const body = AcceptInvitationAsMemberInput.parse(req.body);
    res.json(await authService.acceptInvitationAsMember(req.auth.userId, body.token));
  }));

  // Page publique du lien : organisation et parcours (création de compte ou connexion).
  r.post('/invitations/info', invitationInfoLimiter, wrap(async (req, res) => {
    const body = InvitationInfoInput.parse(req.body);
    res.json(await authService.invitationInfo(body.token));
  }));

  r.post('/forgot-password', forgotLimiter, wrap(async (req, res) => {
    const body = ForgotPasswordInput.parse(req.body);
    await authService.forgotPassword(body.email, body.invite);
    res.sendStatus(204);
  }));

  r.post('/reset-password', wrap(async (req, res) => {
    const body = ResetPasswordInput.parse(req.body);
    await authService.resetPassword(body.token, body.password);
    res.sendStatus(204);
  }));

  // Changement de mot de passe sous session : révoque toutes les sessions et réémet celle de l'appelant.
  r.post('/change-password', requireAuth, changePasswordLimiter, wrap(async (req, res) => {
    if (!req.auth) throw unauthorized();
    const body = ChangePasswordInput.parse(req.body);
    res.json(await authService.changePassword(req.auth.userId, body.current_password, body.new_password));
  }));

  r.get('/me', requireAuth, wrap(async (req, res) => {
    if (!req.auth) throw unauthorized();
    res.json(await authService.me(req.auth.userId));
  }));

  return r;
}
