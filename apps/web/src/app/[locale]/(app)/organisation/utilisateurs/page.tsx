'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Grants } from '@wabagent/contracts';
import { useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { LoadError } from '@/components/feedback/load-error';
import { StaleBanner } from '@/components/feedback/stale-banner';
import { useNotify } from '@/components/feedback/notification-provider';
import { useMutate } from '@/components/feedback/use-mutate';
import type { DescribedFailure } from '@/lib/describe-failure';
import { useSession } from '@/components/providers/session-provider';
import { activeEntities, parseEntityId, type EntitySummary } from '@/lib/entities';
import type { InvitationRow, MemberRow } from '@/lib/grants';
import { MembersTable } from '@/components/organisation/members-table';
import { InvitationsTable } from '@/components/organisation/invitations-table';
import { AccessDrawer, type DrawerMode } from '@/components/organisation/access-drawer';
import { SuspendDialog } from '@/components/organisation/suspend-dialog';
import { RevokeInvitationDialog } from '@/components/organisation/revoke-invitation-dialog';
import { useBusyIds } from '@/components/organisation/use-busy-ids';
import type { RowFailure } from '@/components/organisation/row-error';
import { useOrganisationCounts } from '@/components/organisation/organisation-counts';
import { apiFetch, isOrgChanged } from '@/lib/api-fetch';
import { errorText } from '@/lib/error-text';

type Overlay =
  | { kind: 'invite' }
  | { kind: 'edit'; userId: number }
  | { kind: 'suspend'; userId: number }
  | { kind: 'revoke'; invitationId: number };

export default function UtilisateursPage() {
  const t = useTranslations('organisation.users');
  const notify = useNotify();
  const mutate = useMutate('Users');
  const { me, activeOrg } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshCounts } = useOrganisationCounts();
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [invitations, setInvitations] = useState<InvitationRow[] | null>(null);
  const [entities, setEntities] = useState<EntitySummary[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Relecture en échec après une écriture réussie : les listes affichées sont celles de la dernière lecture.
  const [stale, setStale] = useState(false);
  const [memberErrors, setMemberErrors] = useState<ReadonlyMap<number, RowFailure>>(new Map());
  const [invitationErrors, setInvitationErrors] = useState<ReadonlyMap<number, RowFailure>>(new Map());
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  // Actions de ligne en cours : un renvoi émet un nouveau jeton et un e-mail, il n'est pas idempotent.
  const invitationBusy = useBusyIds();
  const memberBusy = useBusyIds();

  const fetchMembers = useCallback(async () => {
    const res = await apiFetch('/api/users');
    if (await isOrgChanged(res)) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setMembers((await res.json()) as MemberRow[]);
  }, []);

  const fetchInvitations = useCallback(async () => {
    const res = await apiFetch('/api/invitations');
    if (await isOrgChanged(res)) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const all = (await res.json()) as InvitationRow[];
    setInvitations(all.filter((i) => i.accepted_at === null));
  }, []);

  const fetchEntities = useCallback(async () => {
    const res = await apiFetch('/api/entities');
    if (await isOrgChanged(res)) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setEntities(activeEntities((await res.json()) as EntitySummary[]));
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchMembers(), fetchInvitations(), fetchEntities()]).catch((err: unknown) => {
      console.error('[Users] chargement impossible', errorText(err));
      if (alive) setLoadFailed(true);
    });
    return () => { alive = false; };
  }, [fetchMembers, fetchInvitations, fetchEntities, attempt]);

  function retryLoad() {
    setLoadFailed(false);
    setAttempt((n) => n + 1);
  }

  const entityNames = useMemo(() => new Map((entities ?? []).map((e) => [e.id, e.name])), [entities]);

  // Filtre `?entity=<id>` : ignoré si l'entité est inconnue ou archivée.
  const requested = parseEntityId(searchParams?.get('entity') ?? null);
  const filterId = requested !== null && entityNames.has(requested) ? requested : null;
  const filterName = filterId === null ? undefined : entityNames.get(filterId);
  const visibleMembers = useMemo(
    () => (filterId === null ? members ?? [] : (members ?? []).filter((m) => m.memberships.some((x) => x.entity_id === filterId))),
    [members, filterId],
  );

  /** Relecture après un refus : rien n'a été enregistré, un échec ici ne dit pas « Modification enregistrée ». */
  async function reload(load: () => Promise<void>): Promise<void> {
    try {
      await load();
    } catch (err) {
      console.error('[Users] relecture impossible', errorText(err));
    }
  }

  /**
   * Relecture après une écriture réussie. Un échec n'en est pas un pour l'action : le bandeau le dit avec Réessayer
   * (audit §5.1), les listes restent celles de la dernière lecture.
   */
  async function reloadAfterWrite(load: () => Promise<void>): Promise<void> {
    try {
      await load();
    } catch (err) {
      console.error('[Users] relecture impossible', errorText(err));
      setStale(true);
    }
  }

  /** Seule une relecture complète réussie retire le bandeau (une autre liste a pu rester périmée). */
  async function retryStale() {
    try {
      await Promise.all([fetchMembers(), fetchInvitations(), fetchEntities()]);
      setStale(false);
    } catch (err) {
      console.error('[Users] relecture impossible', errorText(err));
    }
  }

  function setRowError(set: typeof setMemberErrors, id: number, rowFailure: RowFailure | null) {
    set((current) => {
      const next = new Map(current);
      if (rowFailure) next.set(id, rowFailure);
      else next.delete(id);
      return next;
    });
  }

  async function submitAccess(mode: DrawerMode, email: string, grants: Grants): Promise<DescribedFailure | null> {
    if (mode.kind === 'invite') {
      const outcome = await mutate('/api/invitations', 'POST', { email, grants });
      if (outcome.status === 'changed') return null;
      if (outcome.status === 'refused') return outcome.failure;
      const sent = (await outcome.res.json().catch(() => null)) as { email?: string } | null;
      setOverlay(null);
      notify.success(t('sent', { email: sent?.email ?? email }));
      await reloadAfterWrite(fetchInvitations);
      refreshCounts();
      return null;
    }
    const outcome = await mutate(`/api/users/${mode.member.user_id}/memberships`, 'PUT', { grants });
    if (outcome.status === 'changed') return null;
    if (outcome.status === 'refused') return outcome.failure;
    setOverlay(null);
    notify.success(t('accessUpdated', { email: mode.member.email }));
    await reloadAfterWrite(fetchMembers);
    return null;
  }

  async function suspend(member: MemberRow): Promise<DescribedFailure | null> {
    const outcome = await mutate(`/api/users/${member.user_id}`, 'PATCH', { status: 'suspended' });
    if (outcome.status === 'changed') return null;
    if (outcome.status === 'refused') return outcome.failure;
    setOverlay(null);
    notify.success(t('suspended', { email: member.email }));
    await reloadAfterWrite(fetchMembers);
    return null;
  }

  async function reactivate(member: MemberRow) {
    if (!memberBusy.begin(member.user_id)) return;
    setRowError(setMemberErrors, member.user_id, null);
    const outcome = await mutate(`/api/users/${member.user_id}`, 'PATCH', { status: 'active' });
    memberBusy.end(member.user_id);
    if (outcome.status === 'changed') return;
    if (outcome.status === 'refused') {
      setRowError(setMemberErrors, member.user_id, { name: member.email, failure: outcome.failure });
      await reload(fetchMembers);
      return;
    }
    await reloadAfterWrite(fetchMembers);
  }

  async function resend(invitation: InvitationRow) {
    if (!invitationBusy.begin(invitation.id)) return;
    setRowError(setInvitationErrors, invitation.id, null);
    const outcome = await mutate(`/api/invitations/${invitation.id}/resend`, 'POST');
    invitationBusy.end(invitation.id);
    if (outcome.status === 'changed') return;
    if (outcome.status === 'refused') {
      setRowError(setInvitationErrors, invitation.id, { name: invitation.email, failure: outcome.failure });
      await reload(fetchInvitations);
      return;
    }
    notify.success(t('resent', { email: invitation.email }));
    await reloadAfterWrite(fetchInvitations);
  }

  async function revoke(invitation: InvitationRow): Promise<DescribedFailure | null> {
    // Garde par identifiant pour l'envoi et la relecture : « Renvoyer » et « Révoquer » de la ligne sont désactivés.
    if (!invitationBusy.begin(invitation.id)) return null;
    try {
      setRowError(setInvitationErrors, invitation.id, null);
      const outcome = await mutate(`/api/invitations/${invitation.id}`, 'DELETE');
      if (outcome.status === 'changed') return null;
      // 404 « introuvable » : l'invitation n'existe plus, mais pas forcément parce qu'on l'a révoquée (renvoi à la même
      // adresse ou acceptation, le moteur la supprime aussi). On ferme et on relit : la liste dit la vérité, sans réussite notifiée.
      if (outcome.status === 'refused' && outcome.httpStatus === 404 && outcome.reason === 'invitation.not_found') {
        setOverlay(null);
        await reload(fetchInvitations);
        refreshCounts();
        return null;
      }
      if (outcome.status === 'refused') return outcome.failure;
      setOverlay(null);
      notify.success(t('revoked', { email: invitation.email }));
      await reloadAfterWrite(fetchInvitations);
      refreshCounts();
      return null;
    } finally {
      invitationBusy.end(invitation.id);
    }
  }

  const loaded = members !== null && invitations !== null && entities !== null;
  const editMember = overlay?.kind === 'edit' ? members?.find((m) => m.user_id === overlay.userId) : undefined;
  const suspendMember = overlay?.kind === 'suspend' ? members?.find((m) => m.user_id === overlay.userId) : undefined;
  const revokeInvitation = overlay?.kind === 'revoke' ? invitations?.find((i) => i.id === overlay.invitationId) : undefined;
  const drawerMode: DrawerMode | null = overlay?.kind === 'invite' ? { kind: 'invite' } : editMember ? { kind: 'edit', member: editMember } : null;

  return (
    <>
      <div className="mb-[18px] flex items-start justify-between">
        <div>
          <h1 className="font-serif text-[26px] font-normal leading-[1.1] text-fg">{t('title')}</h1>
          {loaded || loadFailed ? (
            <p className="mt-[5px] text-[12.5px] text-muted-2">
              {loaded ? t('subtitle', { members: members.length, invitations: invitations.length }) : ''}
            </p>
          ) : (
            <Skeleton className="mt-[7px] h-3 w-48" />
          )}
        </div>
        <Button type="button" disabled={!loaded} onClick={() => setOverlay({ kind: 'invite' })} className="h-auto px-[15px] py-2 text-[13px] font-bold">
          {t('invite')}
        </Button>
      </div>

      {loadFailed && <LoadError message={t('loadError')} onRetry={retryLoad} />}

      {!loaded && !loadFailed && (
        <MembersTable
          members={null}
          entityNames={entityNames}
          meId={me.id}
          onEdit={() => {}}
          onSuspend={() => {}}
          onReactivate={() => {}}
          busyIds={memberBusy.ids}
          rowErrors={memberErrors}
          onDismissError={(id) => setRowError(setMemberErrors, id, null)}
        />
      )}

      {loaded && (
        <>
          {stale && <StaleBanner onRetry={() => void retryStale()} />}
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
            busyIds={memberBusy.ids}
            rowErrors={memberErrors}
            onDismissError={(id) => setRowError(setMemberErrors, id, null)}
          />
          {(invitations.length > 0 || invitationErrors.size > 0) && (
            <>
              <h2 className="mb-2.5 mt-[22px] text-[11px] font-bold uppercase tracking-[1.5px] text-muted-2">{t('pendingTitle')}</h2>
              <InvitationsTable
                invitations={invitations}
                entityNames={entityNames}
                busyIds={invitationBusy.ids}
                rowErrors={invitationErrors}
                onDismissError={(id) => setRowError(setInvitationErrors, id, null)}
                onResend={(i) => void resend(i)}
                onRevoke={(i) => setOverlay({ kind: 'revoke', invitationId: i.id })}
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
      {revokeInvitation && (
        <RevokeInvitationDialog
          email={revokeInvitation.email}
          orgName={activeOrg?.name ?? ''}
          onClose={() => setOverlay(null)}
          onConfirm={() => revoke(revokeInvitation)}
        />
      )}
    </>
  );
}
