'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { ResetPasswordInput } from '@wabagent/contracts';
import { useDescribeFailure } from '@/components/feedback/use-describe-failure';
import { Button } from '@/components/ui/button';
import { sendMutation } from '@/lib/api-fetch';
import { AuthError, type AuthFailure } from './auth-error';
import { PasswordField } from './password-field';

interface Props {
  /** Jeton du lien reçu par e-mail ; vide si le lien est incomplet. */
  token: string;
  /** Jeton d'invitation en cours : après la réinitialisation, retour à l'invitation plutôt qu'à la connexion. */
  invite?: string;
}

/** Contenu de la carte « Nouveau mot de passe » : saisie, ou état « lien invalide ou expiré ». */
export function ResetPasswordForm({ token, invite }: Props) {
  const t = useTranslations('auth');
  const tr = useTranslations('auth.reset');
  const router = useRouter();
  const describe = useDescribeFailure();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<AuthFailure | null>(null);
  const [loading, setLoading] = useState(false);
  const [expired, setExpired] = useState(token === '');
  const busyRef = useRef(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busyRef.current) return;
    setError(null);
    const parsed = ResetPasswordInput.safeParse({ token, password });
    if (!parsed.success) {
      setError({ message: t('passwordTooShort'), reference: null });
      return;
    }
    busyRef.current = true;
    setLoading(true);
    const result = await sendMutation('/api/auth/reset-password', 'POST', parsed.data, t('saveError'), 'Auth');
    if ('res' in result) {
      // le verrou reste posé jusqu'au changement de page : pas de second envoi
      router.push(invite ? `/accept-invite?token=${encodeURIComponent(invite)}` : '/login?reset=1');
      return;
    }
    if (result.status === 401) {
      setExpired(true);
    } else if (result.status === 429) {
      setError({ message: t('rateLimited'), reference: null });
    } else {
      setError({ message: t('saveError'), reference: describe(result, t('saveError')).reference });
    }
    busyRef.current = false;
    setLoading(false);
  }

  if (expired) {
    return (
      <>
        <div role="alert" className="mb-3.5 rounded-lg border border-[#F3C4C4] bg-danger-soft px-[13px] py-[11px] text-[13px] text-[#8f1d1d]">
          {tr('expired')}
        </div>
        <p className="text-[13px] text-muted">{tr('expiredLead')}</p>
        <Link
          href={invite ? `/forgot-password?invite=${encodeURIComponent(invite)}` : '/forgot-password'}
          className="mt-3.5 inline-flex w-full items-center justify-center rounded-md border border-border-strong bg-surface px-4 py-[11px] text-sm text-fg hover:bg-bg"
        >
          {tr('requestNew')}
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className="mb-[18px] font-serif text-[22px] font-normal leading-[1.2] text-fg">{tr('title')}</h1>
      <form onSubmit={onSubmit} noValidate>
        <PasswordField label={tr('password')} value={password} onChange={setPassword} autoComplete="new-password" withMeter />
        {error && <AuthError error={error} />}
        <Button type="submit" disabled={loading} className="mt-[18px] h-auto w-full py-[11px] font-bold">{tr('submit')}</Button>
      </form>
    </>
  );
}
