'use client';
import { useTranslations } from 'next-intl';
import { MiddleColumn, type ColumnGroup } from '@/components/shell/middle-column';

export type OrganisationKey = 'entites' | 'utilisateurs' | 'connexions' | 'reglages';

/** Compteur : nombre, undefined pendant le chargement (squelette), null si la lecture a échoué (rien). */
export interface OrganisationCounts {
  entities?: number | null;
  users?: number | null;
  /** Comptes WhatsApp raccordés (non déconnectés). */
  connections?: number | null;
}

function countProps(value: number | null | undefined): { count?: number; countLoading?: boolean } {
  if (value === undefined) return { countLoading: true };
  return value === null ? {} : { count: value };
}

/** Colonne du milieu de l'espace Organisation (spec 10.7) : bloc Organisation, libellé, entrées et compteurs. */
export function OrganisationRail({ activeKey, counts }: { activeKey: string; counts?: OrganisationCounts }) {
  const t = useTranslations('organisation.rail');

  const groups: ColumnGroup[] = [
    {
      items: [
        {
          key: 'entites',
          label: t('entities'),
          href: '/organisation/entites',
          icon: '◫',
          ...countProps(counts?.entities),
        },
        {
          key: 'utilisateurs',
          label: t('users'),
          href: '/organisation/utilisateurs',
          icon: '◍',
          ...countProps(counts?.users),
        },
        {
          key: 'connexions',
          label: t('connections'),
          href: '/organisation/connexions',
          icon: '⇄',
          ...countProps(counts?.connections),
        },
        { key: 'reglages', label: t('settings'), href: '/organisation/reglages', icon: '⚙' },
      ],
    },
  ];

  return <MiddleColumn kicker={t('kicker')} groups={groups} activeKey={activeKey} />;
}
