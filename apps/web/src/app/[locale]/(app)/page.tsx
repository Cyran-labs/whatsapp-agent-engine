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
import { PageContent, PageHeader, type CreateAction, type ParentCrumb } from '@/components/shell/page-header';
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
  const th = useTranslations('agents.header');
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

  const filter: AgentFilter = parseAgentFilter(new URLSearchParams(searchParams?.toString() ?? ''));
  // Entités lues et filtre d'entité qui ne désigne pas une entité active de l'organisation (archivée, ou d'une autre
  // organisation) : « Entité indisponible » et liste vide, jamais le nom ni toute la liste à sa place (spec en-tête 5, 7.4).
  const unknownEntity = entities !== null && filter.kind === 'entity' && !entityNames.has(filter.entityId);
  const visible = unknownEntity ? [] : applyAgentFilter(list, filter);
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
  // et au libellé « Agents IA ». Lecture en échec : titre « Agents IA », sans bouton rond ; premier lancement : le titre
  // est celui de `FirstRun`, qui porte déjà la création (pas de bouton rond, spec en-tête 7.5).
  const bareFrame = (content: React.ReactNode) => (
    <AppFrame space="agents" column={<MiddleColumn kicker={t('rail.kicker')} groups={[]} activeKey="" />}>
      <PageContent>{content}</PageContent>
    </AppFrame>
  );

  if (rowsFailed) {
    return bareFrame(
      <>
        <PageHeader title={t('title')} />
        {/* contre-audit D-5 : le texte nomme ce qui n'a pas pu être lu */}
        <div className="mx-auto max-w-2xl">
          <LoadError message={tl('agents')} onRetry={() => { setRowsFailed(false); setAttempt((a) => a + 1); }} />
        </div>
      </>,
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

  // En-tête (spec en-tête 2.2, 7.4 ; C-4) : toute la liste, titre seul ; filtrée, parents « Agents IA » et le nom du
  // filtre en titre. Le nom d'une entité vient des entités de l'organisation ouverte, jamais de l'adresse : squelette
  // pendant leur lecture, « Entité indisponible » si elles sont illisibles ou si l'entité n'en fait pas partie.
  const entityName = filter.kind === 'entity' ? (entityNames.get(filter.entityId) ?? null) : null;
  const title: React.ReactNode =
    filter.kind === 'entity'
      ? entityName ?? (entitiesFailed || unknownEntity ? th('entityUnavailable') : <Skeleton className="h-7 w-48" />)
      : filter.kind === 'status' ? t(`rail.${filter.status}`)
      : filter.kind === 'not_responding' ? t('rail.notResponding')
      : t('title');
  const parents: ParentCrumb[] = filter.kind === 'all' ? [] : [{ label: t('title'), href: '/' }];
  const counted = t('count', { count: visible.length });
  const description: React.ReactNode =
    unknownEntity ? null
    : !loaded ? <Skeleton className="mt-[3px] h-3 w-40" />
    : filter.kind === 'entity' ? th('withCount', { label: th('entity'), count: counted })
    : filter.kind === 'status' ? th('withCount', { label: th(`status.${filter.status}`), count: counted })
    : filter.kind === 'not_responding' ? counted
    : th('withCount', { label: th('all'), count: counted });
  // Bouton rond : mêmes droits que l'ancien bouton (administrateur, organisation non en lecture seule) ; rien à créer
  // dans une entité inconnue (P11) ; l'assistant reçoit le filtre d'origine (C-7).
  const create: CreateAction | null =
    isAdmin && !readOnly && !unknownEntity
      ? {
          label: entityName !== null ? th('createIn', { entity: entityName }) : th('create'),
          icon: 'agent',
          href: `/agents/new${agentFilterQuery(filter)}`,
        }
      : null;

  return (
    <AppFrame
      space="agents"
      column={<MiddleColumn kicker={t('rail.kicker')} groups={groups} activeKey={activeKeyOf(filter)} />}
    >
      <PageContent>
        <PageHeader parents={parents} title={title} description={description} create={create} />
        {welcome && <WelcomeBanner organization={welcome} onDismiss={dismissWelcome} />}
        {loaded && <SetupBanner checklist={checklist} hasActive={hasActive} canConnect={isAdmin && !readOnly} connect={connectTarget(list)} />}
        {unknownEntity ? (
          <div className="rounded-xl border border-border bg-surface p-8 text-center text-[13px] text-muted-2 shadow-sm">
            <p>{th('entityUnavailableBody')}</p>
            <Link href="/" className="mt-3 inline-block font-semibold text-accent-ink hover:underline">{th('seeAll')}</Link>
          </div>
        ) : loaded && visible.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface p-8 text-center text-[13px] text-muted-2 shadow-sm">{t('emptyFiltered')}</div>
        ) : (
          <AgentsTable rows={loaded ? visible : null} entityNames={multiEntity && filter.kind !== 'entity' ? entityNames : undefined} />
        )}
      </PageContent>
    </AppFrame>
  );
}
