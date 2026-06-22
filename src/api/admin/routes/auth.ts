import { Router } from 'express';
import type { RequestHandler } from 'express';
import type { AuthService } from '../../../core/auth/auth-service.js';
import { LoginInput, RefreshInput, LogoutInput, AcceptInviteInput, ForgotPasswordInput, ResetPasswordInput } from '../../../contracts/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { createRateLimiter } from '../../middleware/rate-limit.js';
import { unauthorized } from '../../errors.js';

export function authRoutes(authService: AuthService, wrap: (fn: RequestHandler) => RequestHandler): Router {
  const r = Router();
  const loginLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });
  const forgotLimiter = createRateLimiter({ windowMs: 60_000, max: 5 });

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

  r.post('/forgot-password', forgotLimiter, wrap(async (req, res) => {
    const body = ForgotPasswordInput.parse(req.body);
    await authService.forgotPassword(body.email);
    res.sendStatus(204);
  }));

  r.post('/reset-password', wrap(async (req, res) => {
    const body = ResetPasswordInput.parse(req.body);
    await authService.resetPassword(body.token, body.password);
    res.sendStatus(204);
  }));

  r.get('/me', requireAuth, wrap(async (req, res) => {
    if (!req.auth) throw unauthorized();
    res.json(await authService.me(req.auth.userId));
  }));

  return r;
}
