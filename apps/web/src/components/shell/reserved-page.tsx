'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useSession } from '@/components/providers/session-provider';
import { AppFrame } from './app-frame';
import { MiddleColumn } from './middle-column';
import { PageContent, PageHeader } from './page-header';

/**
 * Refus sur place (spec 10.6) : à la même adresse, le cadre normal sans entrée active du rail, la colonne réduite au
 * bloc Organisation, l'en-tête « Page réservée aux administrateurs » sans ligne des parents (spec en-tête 2.2) et une
 * issue vers la liste des agents IA.
 */
export function ReservedPage() {
  const t = useTranslations('shell.reserved');
  const { activeOrg } = useSession();
  return (
    <AppFrame space={null} column={<MiddleColumn groups={[]} activeKey="" />}>
      <PageContent>
        <PageHeader
          title={t('title')}
          // relecture tâche 11, M-4 : sans organisation active, phrase sans nom plutôt qu'un nom vide
          description={activeOrg ? t('body', { org: activeOrg.name }) : t('bodyNoOrg')}
        />
        <Link href="/" className="inline-block text-[13.5px] font-semibold text-accent-ink hover:underline">
          {t('back')}
        </Link>
      </PageContent>
    </AppFrame>
  );
}
