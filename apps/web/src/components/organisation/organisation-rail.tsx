'use client';
import { useTranslations } from 'next-intl';
import { useSession } from '@/components/providers/session-provider';
import { Rail, type RailGroup } from '@/components/shell/rail';

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

export function OrganisationRail({ activeKey, counts }: { activeKey: string; counts?: OrganisationCounts }) {
  const t = useTranslations('organisation.rail');
  const { activeOrg } = useSession();

  const groups: RailGroup[] = [
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

  return <Rail kicker={t('kicker')} title={activeOrg?.name ?? ''} groups={groups} activeKey={activeKey} />;
}
