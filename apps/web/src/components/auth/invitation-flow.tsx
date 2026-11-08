'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { GrantsSummary, InvitationInfo } from '@wabagent/contracts';
import { Link, useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { useRoleLabel, useRoleName } from '@/components/shell/use-role-label';
import { initialsFromEmail, monogram } from '@/lib/organizations';
import { SESSION_EXPIRED_MESSAGE } from '@/lib/session-errors';
import { AuthCard } from './auth-card';
import { AcceptInviteForm } from './accept-invite-form';
import { LoginForm } from './login-form';

/** Vrai si l'adresse a la même première lettre et le même domaine que l'indice masqué (`l•••••@x.fr`). */
export function emailMatchesHint(email: string, hint: string): boolean {
  const split = (value: string): [string, string] | null => {
    const at = value.lastIndexOf('@');
    return at < 1 ? null : [value.slice(0, at), value.slice(at + 1).toLowerCase()];
  };
  const a = split(email);
  const b = split(hint);
  if (!a || !b) return false;
  return a[0][0].toLowerCase() === b[0][0].toLowerCase() && a[1] === b[1];
}

type Load =
  | { status: 'loading' }
  | { status: 'invalid' }
  | { status: 'error'; message: string }
  | { status: 'ready'; info: InvitationInfo; sessionEmail: string | null };

async function fetchSessionEmail(): Promise<string | null> {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) return null;
    const body = (await res.json()) as { user?: { email?: string } };
    return body.user?.email ?? null;
  } catch {
    return null;
  }
}

const PRIMARY_BUTTON = 'mt-[18px] h-auto w-full py-[11px] font-bold';
const GHOST_BUTTON = 'mt-2 h-auto w-full border-border-strong py-[11px] font-normal';

function OrgHeader({ name, grants }: { name: string; grants?: string[] }) {
  const t = useTranslations('auth.invite');
  return (
    <div className="mb-4 flex items-center gap-2.5 border-b border-border pb-4">
      <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-md bg-brand text-[12.5px] font-bold text-brand-mint">
        {monogram(name)}
      </span>
      <div className="flex min-w-0 flex-col items-start">
        <div className="text-[10.5px] font-bold uppercase tracking-[1.2px] text-muted-2">{t('kicker')}</div>
        <div className="font-serif text-[17px] leading-[1.2] text-fg">{name}</div>
        {grants?.map((line) => (
          <span key={line} className="mt-1.5 inline-block rounded-pill bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent-ink">
            {line}
          </span>
        ))}
      </div>
    </div>
  );
}

function useGrantLines(): (grants: GrantsSummary) => string[] {
  const roleLabel = useRoleLabel();
  const roleName = useRoleName();
  return (grants) =>
    grants.scope === 'organization'
      ? [roleLabel({ role: grants.role, read_only: grants.read_only })]
      : grants.entities.map((e) => `${roleName(e.role)} · ${e.entity_name}`);
}

export function InvitationFlow({ token }: { token: string }) {
  const t = useTranslations('auth');
  const ti = useTranslations('auth.invite');
  const tc = useTranslations('common');
  const router = useRouter();
  const grantLines = useGrantLines();
  const [load, setLoad] = useState<Load>({ status: token ? 'loading' : 'invalid' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    setLoad({ status: 'loading' });
    (async () => {
      try {
        const res = await fetch('/api/auth/invitations/info', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (!res.ok) {
          if (!alive) return;
          // 401 (jeton refusé) et 400 (jeton mal formé) : lien invalide ; le reste est un incident à réessayer
          if (res.status === 401 || res.status === 400) setLoad({ status: 'invalid' });
          else setLoad({ status: 'error', message: res.status === 429 ? t('rateLimited') : ti('loadError') });
          return;
        }
        const info = (await res.json()) as InvitationInfo;
        const sessionEmail = info.requires_account_creation ? null : await fetchSessionEmail();
        if (alive) setLoad({ status: 'ready', info, sessionEmail });
      } catch {
        if (alive) setLoad({ status: 'error', message: ti('loadError') });
      }
    })();
    return () => { alive = false; };
    // seuls le jeton et le nombre d'essais relancent le chargement (les traductions ne changent pas en cours de route)
  }, [token, attempt]);

  const setSessionEmail = useCallback((sessionEmail: string | null) => {
    setLoad((current) => (current.status === 'ready' ? { ...current, sessionEmail } : current));
  }, []);

  async function afterLogin() {
    const email = await fetchSessionEmail();
    if (email === null) setError(ti('sessionError'));
    else setError(null);
    setSessionEmail(email);
  }

  async function switchAccount() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setSessionEmail(null);
    busyRef.current = false;
    setBusy(false);
  }

  async function accept(organizationName: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/invitations/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, organization_name: organizationName }),
      });
      if (res.ok) {
        router.push('/?welcome=1');
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.status === 401 && body?.error?.message === SESSION_EXPIRED_MESSAGE) {
        // session expirée (et non invitation refusée) : retour à la connexion, jeton conservé
        busyRef.current = false;
        setBusy(false);
        setSessionEmail(null);
        return;
      }
    } catch {
      // message générique ci-dessous
    }
    setError(t('invalidInvite'));
    busyRef.current = false;
    setBusy(false);
  }

  if (load.status === 'loading') {
    return <AuthCard><p className="text-[13px] text-muted">{tc('loading')}</p></AuthCard>;
  }

  if (load.status === 'error') {
    return (
      <AuthCard compact>
        <div role="alert" className="mb-3.5 rounded-lg border border-[#F3C4C4] bg-danger-soft px-[13px] py-[11px] text-[13px] text-[#8f1d1d]">
          {load.message}
        </div>
        <Button type="button" variant="outline" onClick={() => setAttempt((n) => n + 1)} className={`${GHOST_BUTTON} mt-0`}>
          {tc('retry')}
        </Button>
      </AuthCard>
    );
  }

  if (load.status === 'invalid') {
    return (
      <AuthCard compact>
        <div className="mb-3.5 rounded-lg border border-[#F3C4C4] bg-danger-soft px-[13px] py-[11px] text-[13px] text-[#8f1d1d]">
          {ti('invalidTitle')}
        </div>
        <p className="text-[13px] text-muted">{ti('invalidLead')}</p>
        <Link
          href="/login"
          className="mt-3.5 inline-flex w-full items-center justify-center rounded-md border border-border-strong bg-surface px-4 py-[11px] text-sm text-fg hover:bg-bg"
        >
          {ti('toLogin')}
        </Link>
      </AuthCard>
    );
  }

  const { info, sessionEmail } = load;
  const forgotHref = `/forgot-password?invite=${encodeURIComponent(token)}`;

  if (info.requires_account_creation) {
    return (
      <AuthCard>
        <OrgHeader name={info.organization_name} />
        <AcceptInviteForm token={token} organizationName={info.organization_name} emailHint={info.email_hint} />
      </AuthCard>
    );
  }

  if (sessionEmail === null) {
    return (
      <AuthCard>
        <OrgHeader name={info.organization_name} />
        <h2 className="font-serif text-[22px] font-normal leading-[1.2] text-fg">{ti('loginTitle')}</h2>
        <p className="mb-[18px] mt-1.5 text-[13px] text-muted">{ti('loginLead')}</p>
        {error && <p role="alert" className="mb-3 text-[13px] text-danger">{error}</p>}
        <LoginForm onSuccess={afterLogin} forgotHref={forgotHref} />
      </AuthCard>
    );
  }

  if (!emailMatchesHint(sessionEmail, info.email_hint)) {
    return (
      <AuthCard compact>
        <div className="mb-3.5 rounded-lg border border-[#F3C4C4] bg-danger-soft px-[13px] py-[11px] text-[13px] text-[#8f1d1d]">
          {ti.rich('wrongAccount', { hint: info.email_hint, b: (chunks) => <b>{chunks}</b> })}
        </div>
        <p className="text-[13px] text-muted">{ti('wrongAccountLead', { email: sessionEmail })}</p>
        <Button type="button" disabled={busy} onClick={() => void switchAccount()} className={`${PRIMARY_BUTTON} mt-3.5`}>
          {ti('switchAccount')}
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <OrgHeader name={info.organization_name} grants={grantLines(info.grants_summary)} />
      <h2 className="font-serif text-[22px] font-normal leading-[1.2] text-fg">{ti('joinTitle', { org: info.organization_name })}</h2>
      <p className="mb-[18px] mt-1.5 text-[13px] text-muted">{ti('joinLead')}</p>
      <div className="flex items-center gap-2.5 rounded-lg border border-border bg-surface-subtle px-3 py-2.5 text-[13px]">
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-brand-mint">
          {initialsFromEmail(sessionEmail)}
        </span>
        <div className="min-w-0 break-words">
          {sessionEmail}
          <div className="text-[11.5px] text-muted-2">{ti('connected')}</div>
        </div>
      </div>
      {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
      <Button type="button" disabled={busy} onClick={() => void accept(info.organization_name)} className={PRIMARY_BUTTON}>
        {ti('accept')}
      </Button>
      <Button type="button" variant="outline" disabled={busy} onClick={() => router.push('/')} className={GHOST_BUTTON}>
        {ti('later')}
      </Button>
      <div className="mt-3.5 text-center text-xs text-muted-2">
        {ti('notYou')}{' '}
        <button type="button" disabled={busy} onClick={() => void switchAccount()} className="font-semibold text-accent-ink">
          {ti('switchAccount')}
        </button>
      </div>
    </AuthCard>
  );
}
