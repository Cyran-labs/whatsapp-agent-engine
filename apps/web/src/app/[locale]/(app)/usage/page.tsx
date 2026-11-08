'use client';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { activeEntities, parseEntityId, type EntitySummary } from '@/lib/entities';
import { sumUsage, type UsageSummary } from '@/lib/usage';
import { useSession } from '@/components/providers/session-provider';
import { TopBar } from '@/components/shell/top-bar';
import { PageShell } from '@/components/shell/page-shell';
import { Rail, type RailGroup } from '@/components/shell/rail';
import { UsageSummaryTable } from '@/components/usage/usage-summary-table';
import { apiFetch } from '@/lib/api-fetch';

export default function GlobalUsagePage() {
  const t = useTranslations('usage');
  const { activeOrg } = useSession();
  const searchParams = useSearchParams();
  const [s, setS] = useState<UsageSummary | null>(null);
  const [entities, setEntities] = useState<EntitySummary[] | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch('/api/usage/summary')
      .then((r) => r.json())
      .then((d: UsageSummary) => { if (alive) setS(d); })
      .catch(() => { if (alive) setS(null); });
    apiFetch('/api/entities')
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (alive) setEntities(activeEntities(d as EntitySummary[])); })
      .catch(() => { if (alive) setEntities([]); });
    return () => { alive = false; };
  }, []);

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

  const groups: RailGroup[] = [
    { items: [{ key: 'all', label: t('rail.all'), href: '/usage', icon: '▦' }] },
    ...(multiEntity
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
          {entityName === undefined ? t('globalTitle') : t('entityTitle', { name: entityName })}
        </h1>
        {s && <UsageSummaryTable rows={rows} total={total} entityNames={multiEntity && entityId === null ? entityNames : undefined} />}
      </PageShell>
    </>
  );
}
