'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { AcceptInviteInput } from '@wabagent/contracts';
import { Button } from '@/components/ui/button';

export function AcceptInviteForm({ token }: { token: string }) {
  const t = useTranslations('auth');
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = AcceptInviteInput.safeParse({ token, password });
    if (!parsed.success) {
      setError(t('passwordTooShort'));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/accept-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (res.ok) {
        router.push('/');
        return;
      }
      setError(t('invalidInvite'));
    } catch {
      setError(t('invalidInvite'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex w-full max-w-sm flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm">
        {t('newPassword')}
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="rounded-md border border-border bg-surface px-3 py-2 text-fg"
        />
      </label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" disabled={loading}>{t('acceptSubmit')}</Button>
    </form>
  );
}
