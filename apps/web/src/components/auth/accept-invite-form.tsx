'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { AcceptInviteInput } from '@wabagent/contracts';
import { Button } from '@/components/ui/button';
import { AUTH_INPUT_CLASS, AUTH_LABEL_CLASS, PasswordField } from './password-field';

interface Props {
  token: string;
  organizationName: string;
  emailHint: string;
}

/** Compte neuf : e-mail masqué en lecture seule, mot de passe avec jauge, activation. */
export function AcceptInviteForm({ token, organizationName, emailHint }: Props) {
  const t = useTranslations('auth');
  const ti = useTranslations('auth.invite');
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const busyRef = useRef(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busyRef.current) return;
    setError(null);
    const parsed = AcceptInviteInput.safeParse({ token, password });
    if (!parsed.success) {
      setError(t('passwordTooShort'));
      return;
    }
    busyRef.current = true;
    setLoading(true);
    try {
      const res = await fetch('/api/auth/accept-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...parsed.data, organization_name: organizationName }),
      });
      if (res.ok) {
        // Bandeau de bienvenue seulement si une organisation a été résolue (sinon il n'aurait pas de nom).
        const accepted = (await res.json().catch(() => null)) as { client_id?: string | null } | null;
        router.push(accepted?.client_id ? '/?welcome=1' : '/');
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
      if (res.status === 429 || body?.error?.code === 'RATE_LIMITED') setError(t('rateLimited'));
      else if (res.status >= 500) setError(t('saveError'));
      else setError(t('invalidInvite'));
    } catch {
      setError(t('saveError'));
    }
    busyRef.current = false;
    setLoading(false);
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <h2 className="font-serif text-[22px] font-normal leading-[1.2] text-fg">{ti('createTitle')}</h2>
      <p className="mb-[18px] mt-1.5 text-[13px] text-muted">{ti('createLead')}</p>
      <div className={AUTH_LABEL_CLASS}>{ti('emailLabel')}</div>
      <div className={`${AUTH_INPUT_CLASS} bg-surface-subtle text-muted`} data-testid="email-hint">{emailHint}</div>
      <div className="mt-1.5 text-[11.5px] text-muted-2">{ti('emailHint')}</div>
      <div className="mt-3.5">
        <PasswordField label={t('password')} value={password} onChange={setPassword} autoComplete="new-password" withMeter />
      </div>
      {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
      <Button type="submit" disabled={loading} className="mt-[18px] h-auto w-full py-[11px] font-bold">
        {t('acceptSubmit')}
      </Button>
    </form>
  );
}
