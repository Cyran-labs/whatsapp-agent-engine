'use client';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import type { AgentSummaryRow, ChecklistState } from '@/lib/onboarding';
import { activeEntities, type EntitySummary } from '@/lib/entities';
import { applyAgentFilter, parseAgentFilter, type AgentFilter, type AgentStatus } from '@/lib/agents-filter';
import { useSession } from '@/components/providers/session-provider';
import { SetupBanner } from '@/components/agents/setup-banner';
import { AgentsTable } from '@/components/agents/agents-table';
import { TopBar } from '@/components/shell/top-bar';
import { PageShell } from '@/components/shell/page-shell';
import { Rail, type RailGroup } from '@/components/shell/rail';
import { FirstRun } from '@/components/agents/first-run';
import { WelcomeBanner } from '@/components/agents/welcome-banner';

const STATUS_DOT: Record<AgentStatus, 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  paused: 'warning',
  draft: 'neutral',
};
const STATUSES: AgentStatus[] = ['active', 'paused', 'draft'];

function activeKeyOf(f: AgentFilter): string {
  if (f.kind === 'entity') return `entity-${f.entityId}`;
  if (f.kind === 'status') return `status-${f.status}`;
  return 'all';
}

export default function Home() {
  const t = useTranslations('agents');
  const { activeOrg, isAdmin, readOnly } = useSession();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<AgentSummaryRow[] | null>(null);
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);
  const [entities, setEntities] = useState<EntitySummary[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/bots/summary')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (alive) setRows(d as AgentSummaryRow[]); })
      .catch(() => { if (alive) setRows([]); });
    fetch('/api/entities')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (alive) setEntities(activeEntities(d as EntitySummary[])); })
      .catch(() => { if (alive) setEntities([]); });
    return () => { alive = false; };
  }, []);

  const list = useMemo(() => rows ?? [], [rows]);
  const entityList = useMemo(() => entities ?? [], [entities]);
  const multiEntity = entityList.length > 1;
  const entityNames = useMemo(() => new Map(entityList.map((e) => [e.id, e.name])), [entityList]);

  // Une fois les entités chargées, un filtre d'entité qui ne désigne pas une entité active retombe sur « Tous ».
  const requested = parseAgentFilter(new URLSearchParams(searchParams?.toString() ?? ''));
  const filter: AgentFilter =
    entities !== null && requested.kind === 'entity' && !entityNames.has(requested.entityId) ? { kind: 'all' } : requested;
  const visible = applyAgentFilter(list, filter);
  const welcome = welcomeDismissed ? null : (searchParams?.get('welcome') || null);

  const hasActive = list.some((r) => r.status === 'active');
  const checklist: ChecklistState = {
    created: list.length > 0,
    personalized: list.some((r) => r.personalized),
    connected: false,
    active: hasActive,
  };

  if (rows !== null && list.length === 0) {
    return (
      <>
        <TopBar active="agents" />
        <main className="p-6">
          {welcome && <div className="mx-auto max-w-2xl"><WelcomeBanner organization={welcome} onDismiss={() => setWelcomeDismissed(true)} /></div>}
          <FirstRun />
        </main>
      </>
    );
  }

  const loaded = rows !== null;
  const count = (n: number) => (loaded ? { count: n } : {});
  const groups: RailGroup[] = [
    { items: [{ key: 'all', label: t('rail.all'), href: '/', icon: '▤', ...count(list.length) }] },
    ...(multiEntity
      ? [{
          label: t('rail.groupEntities'),
          items: entityList.map((e) => ({
            key: `entity-${e.id}`,
            label: e.name,
            href: `/?entity=${e.id}`,
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
        href: `/?status=${s}`,
        dot: STATUS_DOT[s],
        ...count(list.filter((r) => r.status === s).length),
      })),
    },
  ];

  const title =
    filter.kind === 'entity' ? (entityNames.get(filter.entityId) ?? '')
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
        {welcome && <WelcomeBanner organization={welcome} onDismiss={() => setWelcomeDismissed(true)} />}
        {loaded && <SetupBanner checklist={checklist} hasActive={hasActive} />}
        <div className="mb-[18px] flex items-start justify-between">
          <div>
            <h1 className="font-serif text-[26px] font-normal leading-[1.1] text-fg">{title}</h1>
            <div className="mt-[5px] text-[12.5px] text-muted-2">{subtitle}</div>
          </div>
          {isAdmin && !readOnly && (
            <Link href={createHref} className="rounded-md bg-accent px-[15px] py-2 text-[13px] font-bold text-accent-fg hover:bg-accent-hover">{t('create')}</Link>
          )}
        </div>
        {loaded && visible.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface p-8 text-center text-[13px] text-muted-2 shadow-sm">{t('emptyFiltered')}</div>
        ) : (
          <AgentsTable rows={visible} entityNames={multiEntity && filter.kind !== 'entity' ? entityNames : undefined} />
        )}
      </PageShell>
    </>
  );
}
