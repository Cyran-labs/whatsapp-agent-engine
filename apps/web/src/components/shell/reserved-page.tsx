'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useSession } from '@/components/providers/session-provider';
import { AppFrame } from './app-frame';
import { MiddleColumn } from './middle-column';
import { PageBar } from './page-bar';

/**
 * Refus sur place (spec 10.6) : à la même adresse, le cadre normal sans entrée active du rail, la colonne réduite au
 * bloc Organisation, le fil « Org › Accès refusé » et une issue vers la liste des agents IA.
 */
export function ReservedPage() {
  const t = useTranslations('shell.reserved');
  const { activeOrg } = useSession();
  return (
    <AppFrame space={null} column={<MiddleColumn groups={[]} activeKey="" />}>
      <PageBar trail={[{ label: t('crumb') }]} />
      <div className="px-8 py-7">
        <h1 className="font-serif text-[26px] leading-tight">{t('title')}</h1>
        <p className="mt-2 text-muted">{t('body', { org: activeOrg?.name ?? '' })}</p>
        <Link href="/" className="mt-4 inline-block text-[13.5px] font-semibold text-accent-ink hover:underline">
          {t('back')}
        </Link>
      </div>
    </AppFrame>
  );
}
