'use client';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { activeEntities, parseEntityId, type EntitySummary } from '@/lib/entities';
import { isUsageAvailable, sumUsage, type UsageSummary } from '@/lib/usage';
import { useSession } from '@/components/providers/session-provider';
import { TopBar } from '@/components/shell/top-bar';
import { PageShell } from '@/components/shell/page-shell';
import { Rail, type RailGroup } from '@/components/shell/rail';
import { UsageSummaryTable } from '@/components/usage/usage-summary-table';
import { Button } from '@/components/ui/button';
import { EntitiesUnavailable } from '@/components/feedback/entities-unavailable';
import { apiFetch } from '@/lib/api-fetch';
import { errorText } from '@/lib/error-text';

export default function GlobalUsagePage() {
  const t = useTranslations('usage');
  const { activeOrg } = useSession();
  const searchParams = useSearchParams();
  const tc = useTranslations('common');
  const [s, setS] = useState<UsageSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [entities, setEntities] = useState<EntitySummary[] | null>(null);
  // Liste des entités illisible : le regroupement par entité n'est pas affiché (jamais une liste vide à sa place).
  const [entitiesFailed, setEntitiesFailed] = useState(false);
  const [entitiesAttempt, setEntitiesAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    apiFetch('/api/usage/summary')
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

  const groups: RailGroup[] = [
    { items: [{ key: 'all', label: t('rail.all'), href: '/usage', icon: '▦' }] },
    ...(entitiesFailed
      ? [{ items: [], notice: <EntitiesUnavailable onRetry={() => setEntitiesAttempt((a) => a + 1)} /> }]
      : multiEntity
      ? [{
          label: t('rail.groupEntities'),
          items: entityList.map((e) => ({ key: `entity-${e.id}`, label: e.name, href: `/usage?entity=${e.id}`, icon: '◫' })),
        }]
      : []),
  ];

  return (
    <>
      <TopBar active="usage" />
      <PageShell
        rail={<Rail kicker={t('rail.kicker')} title={activeOrg?.name ?? ''} groups={groups} activeKey={entityId === null ? 'all' : `entity-${entityId}`} />}
      >
        <h1 className="mb-5 font-serif text-[26px] font-normal leading-[1.1] text-fg">
          {entityName !== undefined || (entityId !== null && entitiesFailed)
            ? t('entityTitle', { name: entityName ?? t('rail.entityUnavailable') })
            : t('globalTitle')}
        </h1>
        {failed && (
          <div role="alert" className="flex items-center justify-between rounded-xl border border-border bg-surface p-5 text-[13px] text-muted shadow-sm">
            <span>{tc('error')}</span>
            <Button variant="outline" onClick={() => { setFailed(false); setAttempt((a) => a + 1); }}>{tc('retry')}</Button>
          </div>
        )}
        {!failed && (
          <UsageSummaryTable
            rows={s ? rows : null}
            total={s ? total : null}
            partial={partial}
            rate={s?.usd_eur_rate ?? null}
            entityNames={multiEntity && entityId === null ? entityNames : undefined}
          />
        )}
      </PageShell>
    </>
  );
}
