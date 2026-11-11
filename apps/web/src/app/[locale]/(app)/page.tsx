'use client';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { connectTarget, deriveChecklist, type AgentSummaryRow, type ChecklistState } from '@/lib/onboarding';
import { activeEntities, type EntitySummary } from '@/lib/entities';
import { agentFilterQuery, applyAgentFilter, isNotResponding, parseAgentFilter, type AgentFilter, type AgentStatus } from '@/lib/agents-filter';
import { useSession } from '@/components/providers/session-provider';
import { SetupBanner } from '@/components/agents/setup-banner';
import { AgentsTable } from '@/components/agents/agents-table';
import { AppFrame } from '@/components/shell/app-frame';
import { MiddleColumn, type ColumnGroup } from '@/components/shell/middle-column';
import { PageBar, type Crumb } from '@/components/shell/page-bar';
import { FirstRun } from '@/components/agents/first-run';
import { WelcomeBanner } from '@/components/agents/welcome-banner';
import { Skeleton } from '@/components/ui/skeleton';
import { EntitiesUnavailable } from '@/components/feedback/entities-unavailable';
import { LoadError } from '@/components/feedback/load-error';
import { apiFetch } from '@/lib/api-fetch';
import { errorText } from '@/lib/error-text';

const STATUSES: AgentStatus[] = ['active', 'limited', 'paused', 'draft'];

/** Lien du rail : la requête vient de agentFilterQuery, jamais reconstruite à la main. */
function railHref(f: AgentFilter): string {
  return `/${agentFilterQuery(f)}`;
}

function activeKeyOf(f: AgentFilter): string {
  if (f.kind === 'entity') return `entity-${f.entityId}`;
  if (f.kind === 'status') return `status-${f.status}`;
  if (f.kind === 'not_responding') return 'not-responding';
  return 'all';
}

export default function Home() {
  const t = useTranslations('agents');
  const tNav = useTranslations('nav');
  const tl = useTranslations('errors.load');
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
        console.error('[Agents] chargement impossible', errorText(err));
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
        console.error('[Agents] chargement des entités impossible', errorText(err));
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

  // Premier lancement et lecture en échec (spec 10.2) : rail et colonne présents, colonne réduite au bloc Organisation
  // et au libellé « Agents IA », fil sans filtre.
  const bareFrame = (content: React.ReactNode) => (
    <AppFrame space="agents" column={<MiddleColumn kicker={t('rail.kicker')} groups={[]} activeKey="" />}>
      <PageBar trail={[{ label: tNav('agents') }]} />
      <div className="px-8 py-7">{content}</div>
    </AppFrame>
  );

  if (rowsFailed) {
    return bareFrame(
      // contre-audit D-5 : le texte nomme ce qui n'a pas pu être lu
      <div className="mx-auto max-w-2xl">
        <LoadError message={tl('agents')} onRetry={() => { setRowsFailed(false); setAttempt((a) => a + 1); }} />
      </div>,
    );
  }

  if (rows !== null && list.length === 0) {
    return bareFrame(
      <>
        {welcome && <div className="mx-auto max-w-2xl"><WelcomeBanner organization={welcome} onDismiss={dismissWelcome} /></div>}
        <FirstRun />
      </>,
    );
  }

  const loaded = rows !== null;
  const count = (n: number) => (loaded ? { count: n } : { countLoading: true });
  // spec 7.3 : entrée « Ne répond pas » seulement si au moins un agent IA porte la mention (jamais pendant la lecture)
  const notRespondingCount = list.filter(isNotResponding).length;
  const groups: ColumnGroup[] = [
    { items: [{ key: 'all', label: t('rail.all'), href: railHref({ kind: 'all' }), icon: '▤', ...count(list.length) }] },
    ...(entitiesFailed
      ? [{ items: [], notice: <EntitiesUnavailable onRetry={() => setEntitiesAttempt((a) => a + 1)} /> }]
      : multiEntity
      ? [{
          label: t('rail.groupEntities'),
          tag: t('rail.entityTag'),
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
      items: [
        ...STATUSES.map((s) => ({
          key: `status-${s}`,
          label: t(`rail.${s}`),
          href: railHref({ kind: 'status', status: s }),
          dot: s,
          ...count(list.filter((r) => r.status === s).length),
        })),
        ...(notRespondingCount > 0
          ? [{
              key: 'not-responding',
              label: t('rail.notResponding'),
              href: railHref({ kind: 'not_responding' }),
              dot: 'danger' as const,
              count: notRespondingCount,
            }]
          : []),
      ],
    },
  ];

  // Titre (spec 10.2) : « Agents IA » ; filtré, « Entité : {nom} », le mot du statut ou « Ne répond pas ».
  // Fil : « Org › Agents IA › » puis « Tous les agents IA », « Entité : {nom} », « Statut : {mot} » ou « Ne répond pas ».
  // Nom d'entité encore en lecture : squelette dans le fil, titre vide ; entités illisibles : « Entité indisponible ».
  const entityLabel =
    filter.kind !== 'entity' ? null
    : entityNames.has(filter.entityId) ? t('rail.entityFilter', { name: entityNames.get(filter.entityId) ?? '' })
    : entitiesFailed ? t('rail.entityUnavailable')
    : null;
  const title =
    filter.kind === 'entity' ? (entityLabel ?? '')
    : filter.kind === 'status' ? t(`rail.${filter.status}`)
    : filter.kind === 'not_responding' ? t('rail.notResponding')
    : t('title');
  const lastCrumb: string | null =
    filter.kind === 'entity' ? entityLabel
    : filter.kind === 'status' ? t('rail.statusFilter', { status: t(`rail.${filter.status}`) })
    : filter.kind === 'not_responding' ? t('rail.notResponding')
    : t('rail.all');
  const subtitle = filter.kind === 'entity' ? t('countInEntity', { count: visible.length }) : t('count', { count: visible.length });
  const createHref = filter.kind === 'entity' ? `/agents/new?entity=${filter.entityId}` : '/agents/new';
  const trail: Crumb[] = [{ label: tNav('agents'), href: '/' }, { label: lastCrumb }];

  return (
    <AppFrame
      space="agents"
      column={<MiddleColumn kicker={t('rail.kicker')} groups={groups} activeKey={activeKeyOf(filter)} />}
    >
      <PageBar
        trail={trail}
        action={
          isAdmin && !readOnly && (
            <Link href={createHref} className="rounded-md bg-accent px-[15px] py-2 text-[13px] font-bold text-accent-fg hover:bg-accent-hover">{t('create')}</Link>
          )
        }
      />
      <div className="px-8 py-7">
        {welcome && <WelcomeBanner organization={welcome} onDismiss={dismissWelcome} />}
        {loaded && <SetupBanner checklist={checklist} hasActive={hasActive} canConnect={isAdmin && !readOnly} connect={connectTarget(list)} />}
        <div className="mb-[18px]">
          <h1 className="font-serif text-[26px] font-normal leading-[1.1] text-fg">{title}</h1>
          {loaded ? (
            <div className="mt-[5px] text-[12.5px] text-muted-2">{subtitle}</div>
          ) : (
            <Skeleton className="mt-[7px] h-3 w-24" />
          )}
        </div>
        {loaded && visible.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface p-8 text-center text-[13px] text-muted-2 shadow-sm">{t('emptyFiltered')}</div>
        ) : (
          <AgentsTable rows={loaded ? visible : null} entityNames={multiEntity && filter.kind !== 'entity' ? entityNames : undefined} />
        )}
      </div>
    </AppFrame>
  );
}
