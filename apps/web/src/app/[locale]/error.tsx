'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg p-6 text-center">
      {/* L'alerte est un conteneur intérieur : `role="alert"` sur `main` en remplacerait le repère. */}
      <div role="alert" className="flex flex-col items-center gap-4">
        <h1 className="font-serif text-2xl text-fg">{t('errors.genericTitle')}</h1>
        <Button onClick={reset}>{t('common.retry')}</Button>
      </div>
    </main>
  );
}
