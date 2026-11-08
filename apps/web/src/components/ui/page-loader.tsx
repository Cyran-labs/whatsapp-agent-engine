'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import styles from './page-loader.module.css';

/**
 * Loader global : affiché tant que la page n'a rien à montrer (session, première requête d'une page
 * publique, transition de route). Une fois le cadre affiché, les données en attente prennent des squelettes.
 */
export function PageLoader({ fullScreen = false }: { fullScreen?: boolean }) {
  const t = useTranslations('common');
  return (
    <div
      role="status"
      className={cn(
        'flex items-center justify-center',
        fullScreen ? 'min-h-screen bg-bg' : 'min-h-[60vh] w-full flex-1',
      )}
    >
      <span aria-hidden="true" className={styles.loader} />
      <span className="sr-only">{t('loading')}</span>
    </div>
  );
}
