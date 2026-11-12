'use client';
import { useTranslations } from 'next-intl';
import { MiddleColumn, type ColumnGroup } from '@/components/shell/middle-column';

export type OrganisationKey = 'entites' | 'utilisateurs' | 'connexions' | 'reglages';

/** Compteur : nombre, undefined pendant le chargement (squelette), null si la lecture a échoué (rien). */
export interface OrganisationCounts {
  entities?: number | null;
  users?: number | null;
  /** Comptes WhatsApp raccordés (non retirés). */
  connections?: number | null;
  /** Comptes WhatsApp en erreur : au moins un, point rouge et « n en erreur » à la place du compteur (prototype 17). */
  connectionErrors?: number | undefined;
}

function countProps(value: number | null | undefined): { count?: number; countLoading?: boolean } {
  if (value === undefined) return { countLoading: true };
  return value === null ? {} : { count: value };
}

/**
 * Colonne du milieu de l'espace Organisation (spec 10.7) : bloc Organisation, entrées et compteurs ; aucun libellé
 * « Organisation » au-dessus des entrées, le bloc le dit déjà (spec en-tête 2.3).
 */
export function OrganisationRail({ activeKey, counts }: { activeKey: string; counts?: OrganisationCounts }) {
  const t = useTranslations('organisation.rail');
  const errors = counts?.connectionErrors ?? 0;

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
          ...(errors > 0 ? { dot: 'danger' as const, alert: t('connectionErrors', { count: errors }) } : {}),
        },
        { key: 'reglages', label: t('settings'), href: '/organisation/reglages', icon: '⚙' },
        // Place réservée (spec 16) : grisée, pastille « Soon », sans effet.
        { key: 'marque', label: t('brand'), href: null, icon: '◈', tooltip: t('brandSoon') },
      ],
    },
  ];

  return <MiddleColumn groups={groups} activeKey={activeKey} />;
}
