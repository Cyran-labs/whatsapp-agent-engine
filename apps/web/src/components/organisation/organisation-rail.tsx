'use client';
import { useTranslations } from 'next-intl';
import { useSession } from '@/components/providers/session-provider';
import { Rail, type RailGroup } from '@/components/shell/rail';

export type OrganisationKey = 'entites' | 'utilisateurs' | 'reglages';

export interface OrganisationCounts {
  entities?: number;
  users?: number;
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
          ...(counts?.entities !== undefined ? { count: counts.entities } : {}),
        },
        {
          key: 'utilisateurs',
          label: t('users'),
          href: '/organisation/utilisateurs',
          icon: '◍',
          ...(counts?.users !== undefined ? { count: counts.users } : {}),
        },
        { key: 'reglages', label: t('settings'), href: '/organisation/reglages', icon: '⚙' },
      ],
    },
  ];

  return <Rail kicker={t('kicker')} title={activeOrg?.name ?? ''} groups={groups} activeKey={activeKey} />;
}
