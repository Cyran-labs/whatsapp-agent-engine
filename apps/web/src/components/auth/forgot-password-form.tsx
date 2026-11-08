'use client';

import { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { ForgotPasswordInput } from '@wabagent/contracts';
import { Button } from '@/components/ui/button';
import { AUTH_INPUT_CLASS, AUTH_LABEL_CLASS } from './password-field';

/** Contenu de la carte « Mot de passe oublié » ; `invite` : jeton d'invitation en cours, pour y revenir. */
export function ForgotPasswordForm({ invite }: { invite?: string }) {
  const t = useTranslations('auth');
  const tf = useTranslations('auth.forgot');
  const emailId = useId();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const busyRef = useRef(false);
  const backHref = invite ? `/accept-invite?token=${encodeURIComponent(invite)}` : '/login';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busyRef.current) return;
    setError(null);
    const parsed = ForgotPasswordInput.safeParse({ email: email.trim() });
    if (!parsed.success) {
      setError(tf('invalidEmail'));
      return;
    }
    busyRef.current = true;
    setLoading(true);
    let failure: string | null = null;
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      // le BFF répond 204 que le compte existe ou non ; seuls 429 et les incidents serveur diffèrent
      if (!res.ok) failure = res.status === 429 ? t('rateLimited') : tf('sendError');
    } catch {
      failure = tf('sendError');
    }
    if (failure) {
      busyRef.current = false;
      setLoading(false);
      setError(failure);
    } else {
      // formulaire remplacé par la confirmation : le verrou reste posé
      setSent(true);
    }
  }

  return (
    <>
      <h1 className="font-serif text-[22px] font-normal leading-[1.2] text-fg">{tf('title')}</h1>
      {sent ? (
        <>
          <div role="status" className="mt-[18px] rounded-lg border border-[#BBE7C8] bg-success-soft px-[13px] py-[11px] text-[13px] text-success-ink">
            {tf('sent')}
          </div>
          <Link
            href={backHref}
            className="mt-3.5 inline-flex w-full items-center justify-center rounded-md border border-border-strong bg-surface px-4 py-[11px] text-sm text-fg hover:bg-bg"
          >
            {tf('back')}
          </Link>
        </>
      ) : (
        <>
          <p className="mb-[18px] mt-1.5 text-[13px] text-muted">{tf('lead')}</p>
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
            {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
            <Button type="submit" disabled={loading} className="mt-[18px] h-auto w-full py-[11px] font-bold">{tf('submit')}</Button>
          </form>
          <div className="mt-3.5 text-center text-xs">
            <Link href={backHref} className="font-semibold text-accent-ink">{tf('back')}</Link>
          </div>
        </>
      )}
    </>
  );
}
