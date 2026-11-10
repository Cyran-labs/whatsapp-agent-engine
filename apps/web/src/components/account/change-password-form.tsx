'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChangePasswordInput } from '@wabagent/contracts';
import { useSession } from '@/components/providers/session-provider';
import { Button } from '@/components/ui/button';
import { sendMutation } from '@/lib/api-fetch';
import { describeFailure } from '@/lib/describe-failure';

const INPUT = 'w-full rounded-lg border border-border bg-surface px-[13px] py-2.5 text-[13.5px] text-fg';

export function ChangePasswordForm() {
  const t = useTranslations('account.security');
  const tAuth = useTranslations('auth');
  const tCommon = useTranslations('common');
  const root = useTranslations();
  const locale = useLocale() as 'fr' | 'en';
  const { me } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setReference(null);
    setDone(false);
    const parsed = ChangePasswordInput.safeParse({ current_password: current, new_password: next });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.path[0] === 'current_password' ? t('currentRequired') : tAuth('passwordTooShort'));
      return;
    }
    setPending(true);
    try {
      const result = await sendMutation('/api/auth/change-password', 'POST', parsed.data, tCommon('error'), 'Account');
      if ('res' in result) {
        setCurrent('');
        setNext('');
        setDone(true);
        return;
      }
      // Organisation changée : apiFetch recharge la page, rien à afficher.
      if (result.orgChanged) return;
      const described = describeFailure(result, {
        fallback: tCommon('error'),
        locale,
        t: (key) => root(key),
        has: (key) => root.has(key),
        fields: ['current_password'],
      });
      // Session expirée : apiFetch a déjà redirigé vers la connexion (audit R-26), aucun texte à ajouter.
      if (described.kind === 'session') return;
      // Le moteur répond en français : le refus attendu est traduit selon la langue de l'interface.
      if (described.kind === 'field' || result.reason === 'auth.current_password_incorrect') {
        setError(t('currentIncorrect'));
        return;
      }
      setError(described.message);
      setReference(described.reference);
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="max-w-[460px] rounded-xl border border-border bg-surface p-[18px] shadow-sm"
    >
      <div className="mb-4">
        <label htmlFor="account-email" className="mb-1.5 block text-[13px] font-semibold">
          {t('email')}
        </label>
        <input
          id="account-email"
          type="email"
          readOnly
          value={me.email}
          className={`${INPUT} bg-surface-subtle text-muted-2`}
        />
        <div className="mt-[5px] text-[11.5px] text-muted-2">{t('emailHint')}</div>
      </div>
      <div className="mb-4">
        <label htmlFor="account-current-password" className="mb-1.5 block text-[13px] font-semibold">
          {t('current')}
        </label>
        <input
          id="account-current-password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className={INPUT}
        />
      </div>
      <div className="mb-4">
        <label htmlFor="account-new-password" className="mb-1.5 block text-[13px] font-semibold">
          {t('new')}
        </label>
        <input
          id="account-new-password"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          className={INPUT}
        />
        <div className="mt-[5px] text-[11.5px] text-muted-2">{t('newHint')}</div>
      </div>
      {error && (
        <div role="alert" className="mb-3 text-sm text-danger">
          <p>{error}</p>
          {reference && <p className="mt-0.5 text-[11.5px]">{root('errors.generic.reference', { reference })}</p>}
        </div>
      )}
      {done && <p role="status" className="mb-3 text-sm text-success-ink">{t('success')}</p>}
      <Button type="submit" disabled={pending} className="h-auto px-[15px] py-2 text-[13px] font-bold text-brand-deep">
        {t('submit')}
      </Button>
    </form>
  );
}
