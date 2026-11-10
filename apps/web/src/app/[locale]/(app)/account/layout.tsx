'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/routing';
import { useSession } from '@/components/providers/session-provider';
import { TopBar } from '@/components/shell/top-bar';
import { PageShell } from '@/components/shell/page-shell';
import { Rail, type RailGroup } from '@/components/shell/rail';
import { openableOrganizations } from '@/lib/organizations';

/** `claire@maison.fr` devient « claire@ » + point de rupture + « maison.fr » pour tenir dans le rail. */
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

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('account.rail');
  const pathname = usePathname();
  const { me } = useSession();
  const count = openableOrganizations(me.organizations).length;

  const groups: RailGroup[] = [
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
    <>
      <TopBar active="account" />
      <PageShell
        rail={
          <Rail
            kicker={t('kicker')}
            title={breakableEmail(me.email)}
            titleClassName="break-words text-[15px]"
            groups={groups}
            activeKey={activeKey}
          />
        }
      >
        {children}
      </PageShell>
    </>
  );
}
