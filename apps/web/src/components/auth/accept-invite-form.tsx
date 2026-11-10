'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { AcceptInviteInput } from '@wabagent/contracts';
import { useDescribeFailure } from '@/components/feedback/use-describe-failure';
import { Button } from '@/components/ui/button';
import { readJsonBody, sendMutation } from '@/lib/api-fetch';
import { AuthError, type AuthFailure } from './auth-error';
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
  const describe = useDescribeFailure();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<AuthFailure | null>(null);
  const [loading, setLoading] = useState(false);
  const busyRef = useRef(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busyRef.current) return;
    setError(null);
    const parsed = AcceptInviteInput.safeParse({ token, password });
    if (!parsed.success) {
      setError({ message: t('passwordTooShort'), reference: null });
      return;
    }
    busyRef.current = true;
    setLoading(true);
    const result = await sendMutation('/api/auth/accept-invite', 'POST', { ...parsed.data, organization_name: organizationName }, t('saveError'), 'Auth');
    if ('res' in result) {
      // Bandeau de bienvenue seulement si une organisation a été résolue (sinon il n'aurait pas de nom).
      const accepted = await readJsonBody<{ client_id?: string | null }>(result.res);
      router.push(accepted?.client_id ? '/?welcome=1' : '/');
      return;
    }
    // Réseau (statut 0) ou panne serveur : texte d'enregistrement et référence ; un autre refus : le lien ne vaut plus.
    if (result.status === 429) setError({ message: t('rateLimited'), reference: null });
    else if (result.status === 0 || result.status >= 500) setError({ message: t('saveError'), reference: describe(result, t('saveError')).reference });
    else setError({ message: t('invalidInvite'), reference: null });
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
      {error && <AuthError error={error} />}
      <Button type="submit" disabled={loading} className="mt-[18px] h-auto w-full py-[11px] font-bold">
        {t('acceptSubmit')}
      </Button>
    </form>
  );
}
