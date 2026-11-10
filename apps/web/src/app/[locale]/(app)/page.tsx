'use client';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { deriveChecklist, type AgentSummaryRow, type ChecklistState } from '@/lib/onboarding';
import { activeEntities, type EntitySummary } from '@/lib/entities';
import { agentFilterQuery, applyAgentFilter, parseAgentFilter, type AgentFilter, type AgentStatus } from '@/lib/agents-filter';
import { useSession } from '@/components/providers/session-provider';
import { SetupBanner } from '@/components/agents/setup-banner';
import { AgentsTable } from '@/components/agents/agents-table';
import { TopBar } from '@/components/shell/top-bar';
import { PageShell } from '@/components/shell/page-shell';
import { Rail, type RailGroup } from '@/components/shell/rail';
import { FirstRun } from '@/components/agents/first-run';
import { WelcomeBanner } from '@/components/agents/welcome-banner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EntitiesUnavailable } from '@/components/feedback/entities-unavailable';
import { apiFetch } from '@/lib/api-fetch';

const STATUS_DOT: Record<AgentStatus, 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  limited: 'warning',
  paused: 'warning',
  draft: 'neutral',
};
const STATUSES: AgentStatus[] = ['active', 'limited', 'paused', 'draft'];

/** Lien du rail : la requête vient de agentFilterQuery, jamais reconstruite à la main. */
function railHref(f: AgentFilter): string {
  return `/${agentFilterQuery(f)}`;
}

function activeKeyOf(f: AgentFilter): string {
  if (f.kind === 'entity') return `entity-${f.entityId}`;
  if (f.kind === 'status') return `status-${f.status}`;
  return 'all';
}

export default function Home() {
  const t = useTranslations('agents');
  const tc = useTranslations('common');
  const { activeOrg, isAdmin, readOnly } = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [rows, setRows] = useState<AgentSummaryRow[] | null>(null);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const [rowsFailed, setRowsFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [entities, setEntities] = useState<EntitySummary[] | null>(null);
  // Liste des entités illisible : le regroupement par entité n'est pas affiché (jamais une liste vide à sa place).
  const [entitiesFailed, setEntitiesFailed] = useState(false);
  const [entitiesAttempt, setEntitiesAttempt] = useState(0);

  // Une erreur n'est pas une liste vide : elle ne doit jamais mener au premier lancement.
  useEffect(() => {
    let alive = true;
    apiFetch('/api/bots/summary')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as AgentSummaryRow[];
      })
      .then((d) => { if (alive) setRows(d); })
      .catch((err: unknown) => {
        console.error('[Agents] chargement impossible', err);
        if (alive) setRowsFailed(true);
      });
    return () => { alive = false; };
  }, [attempt]);

  useEffect(() => {
    let alive = true;
    apiFetch('/api/entities')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<EntitySummary[]>;
      })
      .then((d) => {
        if (!alive) return;
        setEntities(activeEntities(d));
        setEntitiesFailed(false);
      })
      .catch((err: unknown) => {
        console.error('[Agents] chargement des entités impossible', err);
        if (alive) setEntitiesFailed(true);
      });
    return () => { alive = false; };
  }, [entitiesAttempt]);

  const list = useMemo(() => rows ?? [], [rows]);
  const entityList = useMemo(() => entities ?? [], [entities]);
  const multiEntity = entityList.length > 1;
  const entityNames = useMemo(() => new Map(entityList.map((e) => [e.id, e.name])), [entityList]);

  // Une fois les entités chargées, un filtre d'entité qui ne désigne pas une entité active retombe sur « Tous ».
  const requested = parseAgentFilter(new URLSearchParams(searchParams?.toString() ?? ''));
  const filter: AgentFilter =
    entities !== null && requested.kind === 'entity' && !entityNames.has(requested.entityId) ? { kind: 'all' } : requested;
  const visible = applyAgentFilter(list, filter);
  // Le nom vient de la session, jamais de l'URL : le paramètre n'est qu'un drapeau (`welcome=1`).
  const welcome = !welcomeDismissed && searchParams?.get('welcome') === '1' ? (activeOrg?.name ?? null) : null;
  function dismissWelcome() {
    setWelcomeDismissed(true);
    router.replace('/');
  }

  // Une seule règle de mise en route (`deriveChecklist`) : « Accès limité » est en service comme « Actif ».
  const checklist: ChecklistState = deriveChecklist(list);
  const hasActive = checklist.active;

  if (rowsFailed) {
    return (
      <>
        <TopBar active="agents" />
        <main className="p-6">
          <div role="alert" className="mx-auto flex max-w-2xl items-center justify-between rounded-xl border border-border bg-surface p-5 text-[13px] text-muted shadow-sm">
            <span>{tc('error')}</span>
            <Button variant="outline" onClick={() => { setRowsFailed(false); setAttempt((a) => a + 1); }}>{tc('retry')}</Button>
          </div>
        </main>
      </>
    );
  }

  if (rows !== null && list.length === 0) {
    return (
      <>
        <TopBar active="agents" />
        <main className="p-6">
          {welcome && <div className="mx-auto max-w-2xl"><WelcomeBanner organization={welcome} onDismiss={dismissWelcome} /></div>}
          <FirstRun />
        </main>
      </>
    );
  }

  const loaded = rows !== null;
  const count = (n: number) => (loaded ? { count: n } : { countLoading: true });
  const groups: RailGroup[] = [
    { items: [{ key: 'all', label: t('rail.all'), href: railHref({ kind: 'all' }), icon: '▤', ...count(list.length) }] },
    ...(entitiesFailed
      ? [{ items: [], notice: <EntitiesUnavailable onRetry={() => setEntitiesAttempt((a) => a + 1)} /> }]
      : multiEntity
      ? [{
          label: t('rail.groupEntities'),
          items: entityList.map((e) => ({
            key: `entity-${e.id}`,
            label: e.name,
            href: railHref({ kind: 'entity', entityId: e.id }),
            icon: '◫',
            ...count(list.filter((r) => r.entity_id === e.id).length),
          })),
        }]
      : []),
    {
      label: t('rail.groupStatus'),
      items: STATUSES.map((s) => ({
        key: `status-${s}`,
        label: t(`rail.${s}`),
        href: railHref({ kind: 'status', status: s }),
        dot: STATUS_DOT[s],
        ...count(list.filter((r) => r.status === s).length),
      })),
    },
  ];

  const title =
    filter.kind === 'entity' ? (entityNames.get(filter.entityId) ?? (entitiesFailed ? t('rail.entityUnavailable') : ''))
    : filter.kind === 'status' ? t(`rail.${filter.status}`)
    : t('rail.all');
  const subtitle = filter.kind === 'entity' ? t('countInEntity', { count: visible.length }) : t('count', { count: visible.length });
  const createHref = filter.kind === 'entity' ? `/agents/new?entity=${filter.entityId}` : '/agents/new';

  return (
    <>
      <TopBar active="agents" />
      <PageShell
        rail={<Rail kicker={t('rail.kicker')} title={activeOrg?.name ?? ''} groups={groups} activeKey={activeKeyOf(filter)} />}
      >
        {welcome && <WelcomeBanner organization={welcome} onDismiss={dismissWelcome} />}
        {loaded && <SetupBanner checklist={checklist} hasActive={hasActive} canConnect={isAdmin && !readOnly} />}
        <div className="mb-[18px] flex items-start justify-between">
          <div>
            <h1 className="font-serif text-[26px] font-normal leading-[1.1] text-fg">{title}</h1>
            {loaded ? (
              <div className="mt-[5px] text-[12.5px] text-muted-2">{subtitle}</div>
            ) : (
              <Skeleton className="mt-[7px] h-3 w-24" />
            )}
          </div>
          {isAdmin && !readOnly && (
            <Link href={createHref} className="rounded-md bg-accent px-[15px] py-2 text-[13px] font-bold text-accent-fg hover:bg-accent-hover">{t('create')}</Link>
          )}
        </div>
        {loaded && visible.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface p-8 text-center text-[13px] text-muted-2 shadow-sm">{t('emptyFiltered')}</div>
        ) : (
          <AgentsTable rows={loaded ? visible : null} entityNames={multiEntity && filter.kind !== 'entity' ? entityNames : undefined} />
        )}
      </PageShell>
    </>
  );
}
