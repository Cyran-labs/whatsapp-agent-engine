import { z } from 'zod';

const email = z.string().trim().email().transform((s) => s.toLowerCase());
const password = z.string().min(10, 'Le mot de passe doit faire au moins 10 caractères.');

export const LoginInput = z.object({ email, password: z.string().min(1) });
export type LoginInput = z.infer<typeof LoginInput>;

export const RefreshInput = z.object({ refresh_token: z.string().min(1) });
export type RefreshInput = z.infer<typeof RefreshInput>;

export const LogoutInput = z.object({ refresh_token: z.string().min(1) });
export type LogoutInput = z.infer<typeof LogoutInput>;

export const AcceptInviteInput = z.object({ token: z.string().min(1), password });
export type AcceptInviteInput = z.infer<typeof AcceptInviteInput>;

export const ForgotPasswordInput = z.object({ email });
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordInput>;

export const ResetPasswordInput = z.object({ token: z.string().min(1), password });
export type ResetPasswordInput = z.infer<typeof ResetPasswordInput>;
