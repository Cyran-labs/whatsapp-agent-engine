'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { ResetPasswordInput } from '@wabagent/contracts';
import { Button } from '@/components/ui/button';
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
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expired, setExpired] = useState(token === '');
  const busyRef = useRef(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busyRef.current) return;
    setError(null);
    const parsed = ResetPasswordInput.safeParse({ token, password });
    if (!parsed.success) {
      setError(t('passwordTooShort'));
      return;
    }
    busyRef.current = true;
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (res.ok) {
        router.push(invite ? `/accept-invite?token=${encodeURIComponent(invite)}` : '/login?reset=1');
        return;
      }
      if (res.status === 401) {
        setExpired(true);
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
      setError(body?.error?.code === 'RATE_LIMITED' ? t('rateLimited') : t('passwordTooShort'));
    } catch {
      setError(t('passwordTooShort'));
    } finally {
      busyRef.current = false;
      setLoading(false);
    }
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
        {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
        <Button type="submit" disabled={loading} className="mt-[18px] h-auto w-full py-[11px] font-bold">{tr('submit')}</Button>
      </form>
    </>
  );
}
