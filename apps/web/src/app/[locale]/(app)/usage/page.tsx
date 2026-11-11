'use client';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { activeEntities, parseEntityId, type EntitySummary } from '@/lib/entities';
import { isUsageAvailable, sumUsage, type UsageSummary } from '@/lib/usage';
import { AppFrame } from '@/components/shell/app-frame';
import { MiddleColumn, type ColumnGroup } from '@/components/shell/middle-column';
import { PageBar } from '@/components/shell/page-bar';
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

  // Une fois les entités chargées, une entité inconnue ou archivée retombe sur « Toute l'organisation ».
  const requested = parseEntityId(searchParams?.get('entity') ?? null);
  const entityId = requested !== null && (entities === null || entityNames.has(requested)) ? requested : null;
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

  // Fil « Org › Usage et coûts › Toute l'organisation » ou « … › Entité : {nom} », titre « Usage et coûts : toute
  // l'organisation » ou « Usage et coûts : Entité {nom} » (spec 10.8). Nom de l'entité encore en lecture : squelette
  // dans le fil et le titre ; entités illisibles : « Entité indisponible ».
  const lastCrumb =
    entityId === null ? t('rail.all')
    : entityName !== undefined ? t('rail.entityFilter', { name: entityName })
    : entitiesFailed ? t('rail.entityUnavailable')
    : null;
  const title =
    entityId === null ? t('globalTitle')
    : entityName !== undefined ? t('entityTitle', { name: entityName })
    : entitiesFailed ? t('entityUnavailableTitle')
    : <Skeleton className="h-7 w-72" />;
  const trail = [{ label: t('rail.kicker'), href: '/usage' }, { label: lastCrumb }];

  return (
    <AppFrame
      space="usage"
      column={<MiddleColumn kicker={t('rail.kicker')} groups={groups} activeKey={entityId === null ? 'all' : `entity-${entityId}`} />}
    >
      <PageBar trail={trail} action={<PeriodChoice value={period} onChange={choosePeriod} />} />
      <div className="px-8 py-7">
        <h1 className="font-serif text-[26px] font-normal leading-[1.1] text-fg">{title}</h1>
        <p className="mb-5 mt-1.5 text-[13px] text-muted">{t('periodRange', { days: period })}</p>
        {failed && <LoadError message={tl('usage')} onRetry={() => { setFailed(false); setAttempt((a) => a + 1); }} />}
        {!failed && (
          <UsageSummaryTable
            rows={s ? rows : null}
            total={s ? total : null}
            partial={partial}
            rate={s?.usd_eur_rate ?? null}
            entityNames={multiEntity && entityId === null ? entityNames : undefined}
          />
        )}
      </div>
    </AppFrame>
  );
}
