'use client';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useSession } from '@/components/providers/session-provider';
import { OrgSwitcher } from './org-switcher';
import { UserMenu } from './user-menu';

type Active = 'agents' | 'usage' | 'organisation' | 'account';

interface Props {
  active?: Active;
  /** Nom de l'agent IA ouvert : affiche le fil « Agents IA › nom » à la place de la nav. */
  crumb?: string;
}

export function TopBar({ active, crumb }: Props) {
  const t = useTranslations('nav');
  const { me, activeOrg, isPlatformAdmin, isAdmin } = useSession();
  const hasSwitcher = activeOrg !== null && (me.organizations.length > 1 || isPlatformAdmin);

  const links: { key: Active; href: string; label: string }[] = [
    { key: 'agents', href: '/', label: t('agents') },
    { key: 'usage', href: '/usage', label: t('usage') },
    ...(isAdmin ? [{ key: 'organisation' as const, href: '/organisation', label: t('organisation') }] : []),
  ];

  return (
    <header className="flex h-[60px] flex-shrink-0 items-center gap-2.5 bg-brand-deep px-[22px] text-[#E6EFEA]">
      <Link href="/" className="flex items-center gap-2.5 text-base font-semibold tracking-[0.4px]">
        <span className="h-[11px] w-[11px] rounded-full bg-brand-mint" aria-hidden="true" />
        WABAGENT
      </Link>

      {hasSwitcher && (
        <>
          <span className="ml-1.5 mr-1 h-[22px] w-px bg-brand" aria-hidden="true" />
          <OrgSwitcher />
        </>
      )}

      {crumb !== undefined ? (
        <nav className="ml-3.5 flex items-center gap-2 text-[13.5px] text-[#A7BBB1]">
          <Link href="/" className="hover:text-[#E6EFEA]">{t('breadcrumbAgents')}</Link>
          <span aria-hidden="true">›</span>
          <b className="font-semibold text-[#E6EFEA]">{crumb}</b>
        </nav>
      ) : (
        <nav className="ml-3.5 flex items-center gap-1 text-[13.5px]">
          {links.map((link) => (
            <Link
              key={link.key}
              href={link.href}
              aria-current={active === link.key ? 'page' : undefined}
              className={`rounded-md px-3 py-1.5 ${
                active === link.key ? 'bg-brand text-[#E6EFEA]' : 'text-[#A7BBB1] hover:text-[#E6EFEA]'
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      )}

      <div className="flex-1" />
      <UserMenu active={active} />
    </header>
  );
}
