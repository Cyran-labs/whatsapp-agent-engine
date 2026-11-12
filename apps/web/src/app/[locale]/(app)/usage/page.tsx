'use client';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { activeEntities, parseEntityId, type EntitySummary } from '@/lib/entities';
import { isUsageAvailable, sumUsage, type UsageSummary } from '@/lib/usage';
import { AppFrame } from '@/components/shell/app-frame';
import { MiddleColumn, type ColumnGroup } from '@/components/shell/middle-column';
import { PageContent, PageHeader, type ParentCrumb } from '@/components/shell/page-header';
import { Link } from '@/i18n/routing';
import { UsageSummaryTable } from '@/components/usage/usage-summary-table';
import { LoadError } from '@/components/feedback/load-error';
import { EntitiesUnavailable } from '@/components/feedback/entities-unavailable';
import { PeriodChoice, type Period } from '@/components/usage/period-choice';
import { ReservedPage } from '@/components/shell/reserved-page';
import { useSession } from '@/components/providers/session-provider';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch } from '@/lib/api-fetch';
import { errorText } from '@/lib/error-text';
import { periodStart } from '@/lib/period';

export default function GlobalUsagePage() {
  const { isAdmin } = useSession();
  // prototype 5, nav 15.5 : coûts réservés à l'admin (spec 9.1, 10.8). Un autre membre voit le refus sur place
  // (spec 10.6) ; aucune lecture n'est faite et le choix de période n'est jamais rendu.
  if (!isAdmin) return <ReservedPage />;
  return <OrganisationUsage />;
}

function OrganisationUsage() {
  const t = useTranslations('usage');
  const searchParams = useSearchParams();
  const tl = useTranslations('errors.load');
  const [s, setS] = useState<UsageSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [entities, setEntities] = useState<EntitySummary[] | null>(null);
  // Liste des entités illisible : le regroupement par entité n'est pas affiché (jamais une liste vide à sa place).
  const [entitiesFailed, setEntitiesFailed] = useState(false);
  const [entitiesAttempt, setEntitiesAttempt] = useState(0);
  // Période : état de la page, 30 jours par défaut, pas dans l'adresse (choix P-7) ; même début que la page de
  // l'agent IA (`periodStart`, jours du calendrier de Paris).
  const [period, setPeriod] = useState<Period>(30);
  // Nouvelle période : le tableau repasse en chargement, jamais les chiffres de l'ancienne période sous le nouveau libellé.
  const choosePeriod = (p: Period) => {
    if (p === period) return;
    setS(null);
    setFailed(false);
    setPeriod(p);
  };

  useEffect(() => {
    let alive = true;
    // prototype 3 : la période choisie est envoyée au BFF, qui la transmet au moteur.
    apiFetch(`/api/usage/summary?since=${encodeURIComponent(periodStart(period))}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = (await r.json()) as Partial<UsageSummary> | null;
        if (!d || !Array.isArray(d.rows) || !d.total) throw new Error('réponse incomplète');
        return d as UsageSummary;
      })
      .then((d) => { if (alive) setS(d); })
      .catch((err: unknown) => {
        console.error('[Usage] chargement impossible', errorText(err));
        if (alive) setFailed(true);
      });
    return () => { alive = false; };
  }, [attempt, period]);

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
        console.error('[Usage] chargement des entités impossible', errorText(err));
        if (alive) setEntitiesFailed(true);
      });
    return () => { alive = false; };
  }, [entitiesAttempt]);

  const entityList = useMemo(() => entities ?? [], [entities]);
  const multiEntity = entityList.length > 1;
  const entityNames = useMemo(() => new Map(entityList.map((e) => [e.id, e.name])), [entityList]);

  // Le nom d'une entité vient des entités actives de l'organisation ouverte, jamais de l'adresse (spec en-tête 5, D-104) :
  // pendant leur lecture, le filtre est déjà appliqué ; une fois lues, une entité qui n'en fait pas partie (archivée, ou
  // d'une autre organisation) est indisponible : aucune ligne, aucun nom.
  const requested = parseEntityId(searchParams?.get('entity') ?? null);
  const unknownEntity = requested !== null && entities !== null && !entityNames.has(requested);
  const entityId = unknownEntity ? null : requested;
  const entityName = entityId === null ? undefined : entityNames.get(entityId);

  const rows = useMemo(() => {
    const all = s?.rows ?? [];
    return entityId === null ? all : all.filter((r) => r.entity_id === entityId);
  }, [s, entityId]);
  const total = useMemo(() => (entityId === null && s ? s.total : sumUsage(rows)), [s, entityId, rows]);
  // Total partiel : une ligne affichée est indisponible (le filtre par entité recalcule sur les lignes affichées).
  const partial = useMemo(() => rows.some((r) => !isUsageAvailable(r)), [rows]);

  const groups: ColumnGroup[] = [
    { items: [{ key: 'all', label: t('rail.all'), href: '/usage', icon: '▦' }] },
    ...(entitiesFailed
      ? [{ items: [], notice: <EntitiesUnavailable onRetry={() => setEntitiesAttempt((a) => a + 1)} /> }]
      : multiEntity
      ? [{
          label: t('rail.groupEntities'),
          tag: t('rail.entityTag'),
          items: entityList.map((e) => ({ key: `entity-${e.id}`, label: e.name, href: `/usage?entity=${e.id}`, icon: '◫' })),
        }]
      : []),
  ];

  // En-tête (spec en-tête 2.2) : toute l'organisation, titre seul « Usage et coûts », « Toute l'organisation · {période} » ;
  // par entité, parents « Usage et coûts », titre au nom de l'entité (squelette pendant la lecture des entités, « Entité
  // indisponible » si elles sont illisibles), « Entité · {période} ». Choix de période en action, sauf pour une entité
  // indisponible : rien n'y est à lire.
  const periodText = t('periodRange', { days: period });
  const filtered = requested !== null;
  const parents: ParentCrumb[] = filtered ? [{ label: t('header.title'), href: '/usage' }] : [];
  const title =
    !filtered ? t('header.title')
    : unknownEntity || (entityName === undefined && entitiesFailed) ? t('header.entityUnavailable')
    : entityName ?? <Skeleton className="h-7 w-48" />;
  const description = unknownEntity ? null : filtered ? t('header.entity', { period: periodText }) : t('header.all', { period: periodText });

  return (
    <AppFrame
      space="usage"
      column={<MiddleColumn kicker={t('rail.kicker')} groups={groups} activeKey={unknownEntity ? '' : entityId === null ? 'all' : `entity-${entityId}`} />}
    >
      <PageContent>
        <PageHeader
          parents={parents}
          title={title}
          description={description}
          actions={unknownEntity ? undefined : <PeriodChoice value={period} onChange={choosePeriod} />}
        />
        {unknownEntity ? (
          <div className="rounded-xl border border-border bg-surface p-8 text-center text-[13px] text-muted-2 shadow-sm">
            <p>{t('header.entityUnavailableBody')}</p>
            <Link href="/usage" className="mt-3 inline-block font-semibold text-accent-ink hover:underline">{t('header.seeAll')}</Link>
          </div>
        ) : failed ? (
          <LoadError message={tl('usage')} onRetry={() => { setFailed(false); setAttempt((a) => a + 1); }} />
        ) : (
          <UsageSummaryTable
            rows={s ? rows : null}
            total={s ? total : null}
            partial={partial}
            rate={s?.usd_eur_rate ?? null}
            entityNames={multiEntity && entityId === null ? entityNames : undefined}
          />
        )}
      </PageContent>
    </AppFrame>
  );
}
