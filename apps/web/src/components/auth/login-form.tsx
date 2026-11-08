'use client';

import { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, Link } from '@/i18n/routing';
import { LoginInput } from '@wabagent/contracts';
import { Button } from '@/components/ui/button';
import { AUTH_INPUT_CLASS, AUTH_LABEL_CLASS, PasswordField } from './password-field';

interface Props {
  /** Appelé après une connexion réussie, à la place de la redirection vers l'accueil. */
  onSuccess?: () => void | Promise<void>;
  /** Lien « Mot de passe oublié ? » affiché à droite du libellé du mot de passe. */
  forgotHref?: string;
}

export function LoginForm({ onSuccess, forgotHref }: Props) {
  const t = useTranslations('auth');
  const ti = useTranslations('auth.invite');
  const router = useRouter();
  const emailId = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const busyRef = useRef(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busyRef.current) return;
    setError(null);
    const parsed = LoginInput.safeParse({ email, password });
    if (!parsed.success) {
      setError(t('invalidCredentials'));
      return;
    }
    busyRef.current = true;
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (res.ok) {
        if (!onSuccess) {
          router.push('/');
          return;
        }
        // l'appelant peut ne pas changer d'écran (session illisible) : le bouton doit se libérer
        await onSuccess();
        busyRef.current = false;
        setLoading(false);
        return;
      }
      const body = await res.json().catch(() => null);
      setError(body?.error?.code === 'RATE_LIMITED' ? t('rateLimited') : t('invalidCredentials'));
    } catch {
      setError(t('invalidCredentials'));
    }
    busyRef.current = false;
    setLoading(false);
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
      {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
      <Button type="submit" disabled={loading} className="mt-[18px] h-auto w-full py-[11px] font-bold">{t('submit')}</Button>
    </form>
  );
}
