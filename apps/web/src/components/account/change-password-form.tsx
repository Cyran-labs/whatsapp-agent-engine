'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChangePasswordInput } from '@wabagent/contracts';
import { useSession } from '@/components/providers/session-provider';
import { Button } from '@/components/ui/button';

const INPUT = 'w-full rounded-lg border border-border bg-surface px-[13px] py-2.5 text-[13.5px] text-fg';

export function ChangePasswordForm() {
  const t = useTranslations('account.security');
  const tAuth = useTranslations('auth');
  const tCommon = useTranslations('common');
  const { me } = useSession();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setDone(false);
    const parsed = ChangePasswordInput.safeParse({ current_password: current, new_password: next });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.path[0] === 'current_password' ? t('currentRequired') : tAuth('passwordTooShort'));
      return;
    }
    setPending(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (res.ok) {
        setCurrent('');
        setNext('');
        setDone(true);
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(body?.error?.message ?? tCommon('error'));
    } catch (err) {
      console.error('[Account] changement de mot de passe impossible', err);
      setError(tCommon('error'));
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
      {error && <p role="alert" className="mb-3 text-sm text-danger">{error}</p>}
      {done && <p role="status" className="mb-3 text-sm text-success-ink">{t('success')}</p>}
      <Button type="submit" disabled={pending} className="h-auto px-[15px] py-2 text-[13px] font-bold text-brand-deep">
        {t('submit')}
      </Button>
    </form>
  );
}
