'use client';

import { useTranslations } from 'next-intl';
import { LogOut } from 'lucide-react';
import { usePathname, useRouter } from '@/i18n/routing';
import { useSession } from '@/components/providers/session-provider';
import { AppFrame } from '@/components/shell/app-frame';
import { MiddleColumn, type ColumnGroup } from '@/components/shell/middle-column';
import { openableOrganizations } from '@/lib/organizations';

/** `claire@maison.fr` devient « claire@ » + point de rupture + « maison.fr » pour tenir dans la colonne. */
function breakableEmail(email: string): React.ReactNode {
  const at = email.indexOf('@');
  if (at < 0) return email;
  return (
    <>
      {email.slice(0, at + 1)}
      <wbr />
      {email.slice(at + 1)}
    </>
  );
}

/**
 * Pages du compte (spec 11) : rail Compte actif, colonne « Mon compte » sans bloc Organisation, « Se déconnecter » en
 * bas de la colonne (le menu de l'avatar n'existe plus, spec 5.1).
 */
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('account.rail');
  const pathname = usePathname();
  const router = useRouter();
  const { me } = useSession();
  const count = openableOrganizations(me.organizations).length;

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // best-effort : on redirige vers login quoi qu'il arrive
    }
    router.push('/login');
  }

  const groups: ColumnGroup[] = [
    {
      items: [
        {
          key: 'organisations',
          label: t('organisations'),
          href: '/account/organisations',
          icon: '◧',
          ...(count > 0 ? { count } : {}),
        },
        { key: 'preferences', label: t('preferences'), href: '/account/preferences', icon: '◐' },
        { key: 'securite', label: t('security'), href: '/account/securite', icon: '⚿' },
      ],
    },
  ];
  const activeKey = pathname.split('/')[2] ?? 'organisations';

  return (
    <AppFrame
      space="account"
      column={
        <MiddleColumn
          withOrg={false}
          kicker={t('kicker')}
          title={breakableEmail(me.email)}
          titleClassName="break-words text-[15px]"
          groups={groups}
          activeKey={activeKey}
          footer={
            <button
              type="button"
              onClick={() => void logout()}
              className="flex w-full items-center gap-2.5 rounded-md px-[11px] py-[9px] text-left text-[13.5px] text-muted hover:bg-surface-subtle"
            >
              <LogOut className="h-4 w-4 text-muted-2" aria-hidden="true" />
              {t('logout')}
            </button>
          }
        />
      }
    >
      {children}
    </AppFrame>
  );
}
