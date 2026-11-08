'use client';

import { useTranslations } from 'next-intl';
import type { OrgRole, OrganizationSummary } from '@/lib/organizations';

const ROLE_KEYS: Record<OrgRole, 'admin' | 'superManager' | 'manager' | 'advisor'> = {
  admin: 'admin',
  super_manager: 'superManager',
  manager: 'manager',
  advisor: 'advisor',
};

/** Libellé résumé du rôle dans une organisation : « Super manager · lecture seule ». */
export function useRoleLabel(): (org: Pick<OrganizationSummary, 'role' | 'read_only'>) => string {
  const t = useTranslations('shell.roles');
  return (org) => {
    const base = t(ROLE_KEYS[org.role]);
    return org.role === 'super_manager' && org.read_only ? `${base} · ${t('readOnly')}` : base;
  };
}

/** Nom d'un rôle seul (« Manager »), sans mention de lecture seule. */
export function useRoleName(): (role: string) => string {
  const t = useTranslations('shell.roles');
  return (role) => (role in ROLE_KEYS ? t(ROLE_KEYS[role as OrgRole]) : role);
}
