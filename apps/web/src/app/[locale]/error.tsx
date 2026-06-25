'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export default function Error({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg p-6 text-center">
      <h1 className="font-serif text-2xl text-fg">{t('errors.genericTitle')}</h1>
      <Button onClick={reset}>{t('common.retry')}</Button>
    </main>
  );
}
