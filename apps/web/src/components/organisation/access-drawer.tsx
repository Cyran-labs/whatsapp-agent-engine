'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Grants } from '@wabagent/contracts';
import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/feedback/inline-error';
import type { DescribedFailure } from '@/lib/describe-failure';
import type { EntitySummary } from '@/lib/entities';
import {
  formToGrants,
  grantsToForm,
  type AccessForm,
  type EntityGrantRole,
  type MemberRow,
  type OrgGrantRole,
} from '@/lib/grants';

export type DrawerMode = { kind: 'invite' } | { kind: 'edit'; member: MemberRow };

interface Props {
  mode: DrawerMode;
  orgName: string;
  /** Entités actives de l'organisation. */
  entities: EntitySummary[];
  onClose: () => void;
  /** Envoie le formulaire ; renvoie le refus à afficher dans le tiroir, ou null en cas de succès. */
  onSubmit: (email: string, grants: Grants) => Promise<DescribedFailure | null>;
}

type Scope = 'organization' | 'entities';

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;
const GHOST = 'h-auto border-border-strong px-[15px] py-2 text-[13px] font-normal';

function initialState(mode: DrawerMode, entities: EntitySummary[]) {
  const base = { scope: 'entities' as Scope, orgRole: null as OrgGrantRole | null, readOnly: false, picked: {} as Record<number, EntityGrantRole> };
  if (mode.kind === 'invite') return base;
  const form = grantsToForm(mode.member.memberships);
  if (form.scope === 'organization') return { ...base, scope: 'organization' as Scope, orgRole: form.role, readOnly: form.readOnly };
  const activeIds = new Set(entities.map((e) => e.id));
  const picked: Record<number, EntityGrantRole> = {};
  for (const [id, role] of Object.entries(form.entities)) {
    if (activeIds.has(Number(id))) picked[Number(id)] = role;
  }
  return { ...base, picked };
}

function ScopeOption({ checked, title, hint, onSelect }: { checked: boolean; title: string; hint: string; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={`rounded-lg border-[1.5px] px-3 py-2.5 text-left text-xs ${checked ? 'border-accent-ink bg-accent-soft' : 'border-border'} text-muted-2`}
    >
      <b className="mb-px block text-[13px] font-semibold text-fg">{title}</b>
      {hint}
    </button>
  );
}

function RoleSegment({ label, role, disabled, onChange }: { label: string; role: EntityGrantRole; disabled: boolean; onChange: (role: EntityGrantRole) => void }) {
  const t = useTranslations('shell.roles');
  const options: EntityGrantRole[] = ['manager', 'advisor'];
  return (
    <div role="radiogroup" aria-label={label} className={`inline-flex overflow-hidden rounded-md border border-border-strong bg-surface ${disabled ? 'opacity-40' : ''}`}>
      {options.map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={role === value}
          disabled={disabled}
          onClick={() => onChange(value)}
          className={`px-2.5 py-[3px] text-xs font-semibold first:border-0 [&:not(:first-child)]:border-l [&:not(:first-child)]:border-border-strong ${
            role === value ? 'bg-brand text-[#E6EFEA]' : 'text-muted'
          }`}
        >
          {t(value)}
        </button>
      ))}
    </div>
  );
}

export function AccessDrawer({ mode, orgName, entities, onClose, onSubmit }: Props) {
  const t = useTranslations('organisation.users.drawer');
  const ts = useTranslations('shell.roles');
  const editing = mode.kind === 'edit';
  const initial = initialState(mode, entities);
  const [email, setEmail] = useState(editing ? mode.member.email : '');
  const [scope, setScope] = useState<Scope>(initial.scope);
  const [orgRole, setOrgRole] = useState<OrgGrantRole | null>(initial.orgRole);
  const [readOnly, setReadOnly] = useState(initial.readOnly);
  const [picked, setPicked] = useState<Record<number, EntityGrantRole>>(initial.picked);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<DescribedFailure | null>(null);

  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // Fermeture ignorée tant qu'un envoi est en cours.
  const closeRef = useRef(() => {
    if (!busyRef.current) onClose();
  });
  closeRef.current = () => {
    if (!busyRef.current) onClose();
  };

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (!editing) panelRef.current?.querySelector<HTMLInputElement>('input[type="email"]')?.focus();
    else panelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [editing]);

  const form: AccessForm | null =
    scope === 'organization'
      ? orgRole
        ? { scope: 'organization', role: orgRole, readOnly }
        : null
      : Object.keys(picked).length > 0
        ? { scope: 'entities', entities: picked }
        : null;
  const emailOk = editing || EMAIL_PATTERN.test(email.trim());
  const canSubmit = form !== null && emailOk && !busy;

  function toggleEntity(id: number, checked: boolean) {
    setPicked((current) => {
      const next = { ...current };
      if (checked) next[id] = 'advisor';
      else delete next[id];
      return next;
    });
  }

  async function submit() {
    if (busyRef.current || !form || !emailOk) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const refusal = await onSubmit(email.trim(), formToGrants(form));
    busyRef.current = false;
    setBusy(false);
    if (refusal) setError(refusal);
  }

  const card = (selected: boolean) => `mb-2 flex gap-2.5 rounded-lg border-[1.5px] px-3 py-2.5 text-xs text-muted-2 ${selected ? 'border-accent-ink bg-accent-soft' : 'border-border'}`;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div aria-hidden="true" onClick={() => closeRef.current()} className="absolute inset-0 bg-[rgba(20,50,42,0.18)]" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex h-full w-[430px] max-w-full flex-col border-l border-border bg-surface px-[22px] pb-[18px] pt-[22px] text-fg shadow-lg outline-none"
      >
        <div className="flex-1 overflow-y-auto">
          <h4 id={titleId} className="font-serif text-[21px] font-normal">{editing ? t('editTitle') : t('inviteTitle')}</h4>
          <p className="mb-[18px] mt-[3px] text-[12.5px] text-muted-2">{editing ? mode.member.email : t('inviteSub', { org: orgName })}</p>

          <label htmlFor={`${titleId}-email`} className="mb-1.5 block text-[13px] font-semibold">{t('emailLabel')}</label>
          <input
            id={`${titleId}-email`}
            type="email"
            value={email}
            readOnly={editing}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
            }}
            className={`w-full rounded-lg px-3 py-[9px] text-[13.5px] outline-none ${
              editing
                ? 'border border-border bg-surface-subtle text-muted'
                : 'border-[1.5px] border-accent-ink bg-surface text-fg shadow-[0_0_0_3px_rgba(110,231,183,0.28)]'
            }`}
          />

          <div id={`${titleId}-access`} className="mb-1.5 mt-4 text-[13px] font-semibold">{t('accessLabel')}</div>
          <div role="radiogroup" aria-labelledby={`${titleId}-access`} className="mb-3.5 grid grid-cols-2 gap-2">
            <ScopeOption checked={scope === 'organization'} title={t('scopeOrganization')} hint={t('scopeOrganizationHint')} onSelect={() => setScope('organization')} />
            <ScopeOption checked={scope === 'entities'} title={t('scopeEntities')} hint={t('scopeEntitiesHint')} onSelect={() => setScope('entities')} />
          </div>

          {scope === 'organization' ? (
            <div role="radiogroup" aria-label={t('roleLabel')}>
              <div className={card(orgRole === 'admin')}>
                <button type="button" role="radio" aria-checked={orgRole === 'admin'} onClick={() => setOrgRole('admin')} className="flex flex-1 gap-2.5 text-left">
                  <Radio checked={orgRole === 'admin'} />
                  <span><b className="block text-[13px] font-semibold text-fg">{ts('admin')}</b>{t('adminDescription')}</span>
                </button>
              </div>
              <div className={`${card(orgRole === 'super_manager')} flex-col`}>
                <button type="button" role="radio" aria-checked={orgRole === 'super_manager'} onClick={() => setOrgRole('super_manager')} className="flex gap-2.5 text-left">
                  <Radio checked={orgRole === 'super_manager'} />
                  <span><b className="block text-[13px] font-semibold text-fg">{ts('superManager')}</b>{t('superManagerDescription')}</span>
                </button>
                {orgRole === 'super_manager' && (
                  <div className="mt-2 flex items-center gap-2.5 border-t border-[rgba(15,122,85,0.2)] pt-2 text-muted">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={readOnly}
                      aria-label={t('readOnlyLabel')}
                      onClick={() => setReadOnly((v) => !v)}
                      className={`relative h-[18px] w-8 shrink-0 rounded-full ${readOnly ? 'bg-accent-ink' : 'bg-border-strong'}`}
                    >
                      <span aria-hidden="true" className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white ${readOnly ? 'right-0.5' : 'left-0.5'}`} />
                    </button>
                    <span><b className="text-[12.5px] font-semibold text-fg">{t('readOnlyLabel')}</b>{t('readOnlyHint')}</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              {entities.map((entity) => {
                const on = entity.id in picked;
                return (
                  <div key={entity.id} className={`mb-1.5 flex items-center gap-2.5 rounded-lg border px-3 py-[9px] text-[13px] ${on ? 'border-accent-ink bg-accent-soft' : 'border-border'}`}>
                    <label className="flex flex-1 items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => toggleEntity(entity.id, e.target.checked)}
                        className="h-4 w-4 accent-[var(--accent-ink)]"
                      />
                      {entity.name}
                    </label>
                    <RoleSegment
                      label={t('entityRole', { name: entity.name })}
                      role={picked[entity.id] ?? 'advisor'}
                      disabled={!on}
                      onChange={(role) => setPicked((current) => ({ ...current, [entity.id]: role }))}
                    />
                  </div>
                );
              })}
              <div className="mt-3 rounded-lg border border-border bg-surface-subtle px-3 py-2.5 text-xs text-muted">{t('info')}</div>
            </>
          )}
        </div>

        {error && <div className="mt-3"><InlineError message={error.message} reference={error.reference} /></div>}
        <div className="mt-4 flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="outline" onClick={() => closeRef.current()} className={GHOST}>{t('cancel')}</Button>
          <Button type="button" disabled={!canSubmit} onClick={() => void submit()} className="h-auto px-[15px] py-2 text-[13px] font-bold">
            {editing ? t('save') : t('send')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Radio({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`mt-0.5 h-4 w-4 shrink-0 rounded-full bg-surface ${checked ? 'border-[5px] border-accent-ink' : 'border-[1.5px] border-border-strong'}`}
    />
  );
}
