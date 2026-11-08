'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Grants } from '@wabagent/contracts';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { useSession } from '@/components/providers/session-provider';
import { activeEntities, parseEntityId, type EntitySummary } from '@/lib/entities';
import type { InvitationRow, MemberRow } from '@/lib/grants';
import { MembersTable } from '@/components/organisation/members-table';
import { InvitationsTable } from '@/components/organisation/invitations-table';
import { AccessDrawer, type DrawerMode } from '@/components/organisation/access-drawer';
import { SuspendDialog } from '@/components/organisation/suspend-dialog';
import { useOrganisationCounts } from '@/components/organisation/organisation-counts';

type Overlay = { kind: 'invite' } | { kind: 'edit'; userId: number } | { kind: 'suspend'; userId: number };

const NOTICE_MS = 6000;

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message || fallback;
  } catch {
    return fallback;
  }
}

export default function UtilisateursPage() {
  const t = useTranslations('organisation.users');
  const tc = useTranslations('common');
  const { me, activeOrg } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshCounts } = useOrganisationCounts();
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [invitations, setInvitations] = useState<InvitationRow[] | null>(null);
  const [entities, setEntities] = useState<EntitySummary[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay | null>(null);

  const fetchMembers = useCallback(async () => {
    const res = await fetch('/api/users');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setMembers((await res.json()) as MemberRow[]);
  }, []);

  const fetchInvitations = useCallback(async () => {
    const res = await fetch('/api/invitations');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const all = (await res.json()) as InvitationRow[];
    setInvitations(all.filter((i) => i.accepted_at === null));
  }, []);

  const fetchEntities = useCallback(async () => {
    const res = await fetch('/api/entities');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setEntities(activeEntities((await res.json()) as EntitySummary[]));
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchMembers(), fetchInvitations(), fetchEntities()]).catch((err: unknown) => {
      console.error('[Users] chargement impossible', err);
      if (alive) setLoadFailed(true);
    });
    return () => { alive = false; };
  }, [fetchMembers, fetchInvitations, fetchEntities]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const entityNames = useMemo(() => new Map((entities ?? []).map((e) => [e.id, e.name])), [entities]);

  // Filtre `?entity=<id>` : ignoré si l'entité est inconnue ou archivée.
  const requested = parseEntityId(searchParams?.get('entity') ?? null);
  const filterId = requested !== null && entityNames.has(requested) ? requested : null;
  const filterName = filterId === null ? undefined : entityNames.get(filterId);
  const visibleMembers = useMemo(
    () => (filterId === null ? members ?? [] : (members ?? []).filter((m) => m.memberships.some((x) => x.entity_id === filterId))),
    [members, filterId],
  );

  /** Envoie une mutation ; renvoie la réponse, ou le message d'erreur du moteur. */
  async function send(url: string, method: string, body?: unknown): Promise<{ res: Response } | { error: string }> {
    try {
      const res = await fetch(url, {
        method,
        ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
      return res.ok ? { res } : { error: await errorMessage(res, tc('error')) };
    } catch (err) {
      console.error('[Users] envoi impossible', err);
      return { error: tc('error') };
    }
  }

  async function reload(load: () => Promise<void>) {
    try {
      await load();
    } catch (err) {
      console.error('[Users] relecture impossible', err);
    }
  }

  async function submitAccess(mode: DrawerMode, email: string, grants: Grants): Promise<string | null> {
    setActionError(null);
    if (mode.kind === 'invite') {
      const result = await send('/api/invitations', 'POST', { email, grants });
      if ('error' in result) return result.error;
      const sent = (await result.res.json().catch(() => null)) as { email?: string } | null;
      setOverlay(null);
      setNotice(t('sent', { email: sent?.email ?? email }));
      await reload(fetchInvitations);
      refreshCounts();
      return null;
    }
    const result = await send(`/api/users/${mode.member.user_id}/memberships`, 'PUT', { grants });
    if ('error' in result) return result.error;
    setOverlay(null);
    await reload(fetchMembers);
    return null;
  }

  async function setStatus(member: MemberRow, status: 'active' | 'suspended'): Promise<string | null> {
    const result = await send(`/api/users/${member.user_id}`, 'PATCH', { status });
    if ('error' in result) return result.error;
    await reload(fetchMembers);
    return null;
  }

  async function suspend(member: MemberRow): Promise<string | null> {
    const err = await setStatus(member, 'suspended');
    if (!err) setOverlay(null);
    return err;
  }

  async function reactivate(member: MemberRow) {
    setActionError(null);
    const err = await setStatus(member, 'active');
    if (err) setActionError(err);
  }

  async function resend(invitation: InvitationRow) {
    setActionError(null);
    const result = await send(`/api/invitations/${invitation.id}/resend`, 'POST');
    if ('error' in result) {
      setActionError(result.error);
      return;
    }
    setNotice(t('resent', { email: invitation.email }));
    await reload(fetchInvitations);
  }

  async function revoke(invitation: InvitationRow) {
    setActionError(null);
    const result = await send(`/api/invitations/${invitation.id}`, 'DELETE');
    if ('error' in result) {
      setActionError(result.error);
      return;
    }
    await reload(fetchInvitations);
    refreshCounts();
  }

  const loaded = members !== null && invitations !== null && entities !== null;
  const editMember = overlay?.kind === 'edit' ? members?.find((m) => m.user_id === overlay.userId) : undefined;
  const suspendMember = overlay?.kind === 'suspend' ? members?.find((m) => m.user_id === overlay.userId) : undefined;
  const drawerMode: DrawerMode | null = overlay?.kind === 'invite' ? { kind: 'invite' } : editMember ? { kind: 'edit', member: editMember } : null;

  return (
    <>
      <div className="mb-[18px] flex items-start justify-between">
        <div>
          <h1 className="font-serif text-[26px] font-normal leading-[1.1] text-fg">{t('title')}</h1>
          <p className="mt-[5px] text-[12.5px] text-muted-2">
            {loaded ? t('subtitle', { members: members.length, invitations: invitations.length }) : ''}
          </p>
        </div>
        <Button type="button" disabled={!loaded} onClick={() => setOverlay({ kind: 'invite' })} className="h-auto px-[15px] py-2 text-[13px] font-bold">
          {t('invite')}
        </Button>
      </div>

      {(loadFailed || actionError) && (
        <p role="alert" className="mb-3 text-[12.5px] text-danger">{loadFailed ? t('loadError') : actionError}</p>
      )}

      {loaded && (
        <>
          {filterId !== null && (
            <div className="mb-3">
              <span className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-surface-subtle py-[3px] pl-2.5 pr-1.5 text-xs text-muted">
                <span>{t('filterChip', { name: filterName ?? '' })}</span>
                <button
                  type="button"
                  aria-label={t('filterRemove')}
                  onClick={() => router.replace('/organisation/utilisateurs')}
                  className="flex h-4 w-4 items-center justify-center rounded-full text-sm leading-none text-muted-2 hover:bg-border"
                >
                  <span aria-hidden="true">×</span>
                </button>
              </span>
            </div>
          )}
          <MembersTable
            members={visibleMembers}
            entityNames={entityNames}
            meId={me.id}
            onEdit={(m) => setOverlay({ kind: 'edit', userId: m.user_id })}
            onSuspend={(m) => setOverlay({ kind: 'suspend', userId: m.user_id })}
            onReactivate={(m) => void reactivate(m)}
          />
          {invitations.length > 0 && (
            <>
              <h2 className="mb-2.5 mt-[22px] text-[11px] font-bold uppercase tracking-[1.5px] text-muted-2">{t('pendingTitle')}</h2>
              <InvitationsTable
                invitations={invitations}
                entityNames={entityNames}
                onResend={(i) => void resend(i)}
                onRevoke={(i) => void revoke(i)}
              />
            </>
          )}
        </>
      )}

      {drawerMode && entities && (
        <AccessDrawer
          mode={drawerMode}
          orgName={activeOrg?.name ?? ''}
          entities={entities}
          onClose={() => setOverlay(null)}
          onSubmit={(email, grants) => submitAccess(drawerMode, email, grants)}
        />
      )}
      {suspendMember && (
        <SuspendDialog
          email={suspendMember.email}
          orgName={activeOrg?.name ?? ''}
          onClose={() => setOverlay(null)}
          onConfirm={() => suspend(suspendMember)}
        />
      )}

      {notice && (
        <div role="status" className="fixed bottom-[22px] left-1/2 z-50 -translate-x-1/2 rounded-lg bg-brand-deep px-4 py-2.5 text-[13px] text-[#E6EFEA] shadow-lg">
          {notice}
        </div>
      )}
    </>
  );
}
