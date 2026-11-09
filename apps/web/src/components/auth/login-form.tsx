'use client';

import { useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter, Link, type routing } from '@/i18n/routing';
import { LoginInput } from '@wabagent/contracts';
import { Button } from '@/components/ui/button';
import { sendMutation, type MutationFailure } from '@/lib/api-fetch';
import { describeFailure } from '@/lib/describe-failure';
import { AUTH_INPUT_CLASS, AUTH_LABEL_CLASS, PasswordField } from './password-field';

interface Props {
  /** Appelé après une connexion réussie, à la place de la redirection vers l'accueil. */
  onSuccess?: () => void | Promise<void>;
  /** Lien « Mot de passe oublié ? » affiché à droite du libellé du mot de passe. */
  forgotHref?: string;
  /** Où aller après la connexion (chemin sûr déjà séparé de sa langue, voir `splitLocale`), sinon l'accueil. */
  redirectTo?: { path: string; locale: Locale | null };
}

type Locale = (typeof routing.locales)[number];

interface LoginError {
  message: string;
  reference: string | null;
}

export function LoginForm({ onSuccess, forgotHref, redirectTo }: Props) {
  const t = useTranslations('auth');
  const root = useTranslations();
  const locale = useLocale() as 'fr' | 'en';
  const ti = useTranslations('auth.invite');
  const router = useRouter();
  const emailId = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<LoginError | null>(null);
  const [loading, setLoading] = useState(false);
  const busyRef = useRef(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busyRef.current) return;
    setError(null);
    const parsed = LoginInput.safeParse({ email, password });
    if (!parsed.success) {
      setError({ message: t('invalidCredentials'), reference: null });
      return;
    }
    busyRef.current = true;
    setLoading(true);
    const result = await sendMutation('/api/auth/login', 'POST', parsed.data, t('loginUnavailable'), 'Auth');
    if ('res' in result) {
      if (!onSuccess) {
        if (!redirectTo) router.push('/');
        else if (redirectTo.locale) router.push(redirectTo.path, { locale: redirectTo.locale });
        else router.push(redirectTo.path);
        return;
      }
      // l'appelant peut ne pas changer d'écran (session illisible) : le bouton doit se libérer
      await onSuccess();
      busyRef.current = false;
      setLoading(false);
      return;
    }
    setError(loginError(result));
    busyRef.current = false;
    setLoading(false);
  }

  /**
   * Refus de la connexion (audit R-1) : seuls 400 et 401 disent « identifiants invalides » (ou le texte de leur clé) ;
   * 429 dit trop de tentatives ; une panne, une réponse inattendue ou le réseau disent que la connexion est impossible.
   */
  function loginError(failure: MutationFailure): LoginError {
    const described = describeFailure(failure, {
      fallback: t('loginUnavailable'),
      locale,
      t: (key) => root(key),
      has: (key) => root.has(key),
    });
    if (failure.status === 400 || failure.status === 401) {
      return { message: failure.reason !== null ? described.message : t('invalidCredentials'), reference: null };
    }
    if (failure.status === 429) return { message: described.message, reference: null };
    return { message: t('loginUnavailable'), reference: described.reference };
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className={AUTH_LABEL_CLASS}>
        <label htmlFor={emailId}>{t('email')}</label>
      </div>
      <div className={AUTH_INPUT_CLASS}>
        <input
          id={emailId}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          className="min-w-0 flex-1 bg-transparent text-[13.5px] text-fg outline-none"
        />
      </div>
      <div className="mt-3.5">
        <PasswordField
          label={t('password')}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          labelAction={
            forgotHref ? (
              <Link href={forgotHref} className="text-[12.5px] font-medium text-accent-ink">{ti('forgot')}</Link>
            ) : undefined
          }
        />
      </div>
      {error && (
        <div role="alert" className="mt-3 text-[13px] text-danger">
          <p>{error.message}</p>
          {error.reference && <p className="mt-0.5 text-[11.5px]">{root('errors.generic.reference', { reference: error.reference })}</p>}
        </div>
      )}
      <Button type="submit" disabled={loading} className="mt-[18px] h-auto w-full py-[11px] font-bold">{t('submit')}</Button>
    </form>
  );
}
