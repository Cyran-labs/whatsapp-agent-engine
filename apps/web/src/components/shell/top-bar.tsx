'use client';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { TopBarActions } from './top-bar-actions';

type Props =
  | { variant: 'root'; activeNav?: 'agents' | 'usage' }
  | { variant: 'agent'; agentName: string };

export function TopBar(props: Props) {
  const t = useTranslations('nav');
  return (
    <header className="flex h-[60px] flex-shrink-0 items-center gap-2.5 bg-brand-deep px-[22px] text-[#E6EFEA]">
      <Link href="/" className="flex items-center gap-2.5 text-base font-semibold tracking-[0.4px]">
        <span className="h-[11px] w-[11px] rounded-full bg-brand-mint" aria-hidden="true" />
        WABAGENT
      </Link>

      {props.variant === 'root' ? (
        <nav className="ml-3.5 flex items-center gap-1 text-[13.5px]">
          <Link
            href="/"
            className={`rounded-md px-3 py-1.5 ${props.activeNav !== 'usage' ? 'bg-brand text-[#E6EFEA]' : 'text-[#A7BBB1] hover:text-[#E6EFEA]'}`}
          >
            {t('agents')}
          </Link>
          <Link
            href="/usage"
            className={`rounded-md px-3 py-1.5 ${props.activeNav === 'usage' ? 'bg-brand text-[#E6EFEA]' : 'text-[#A7BBB1] hover:text-[#E6EFEA]'}`}
          >
            {t('usage')}
          </Link>
          <span className="flex items-center gap-2 rounded-md px-3 py-1.5 text-[#A7BBB1]/60">
            {t('settings')}
            <span className="rounded-full border border-brand px-2 py-px text-[9.5px] uppercase tracking-wide">
              {t('comingSoon')}
            </span>
          </span>
        </nav>
      ) : (
        <nav className="ml-3.5 flex items-center gap-2 text-[13.5px] text-[#A7BBB1]">
          <Link href="/" className="hover:text-[#E6EFEA]">{t('breadcrumbAgents')}</Link>
          <span aria-hidden="true">›</span>
          <b className="font-semibold text-[#E6EFEA]">{props.agentName}</b>
        </nav>
      )}

      <div className="flex-1" />
      <TopBarActions />
    </header>
  );
}
