import { useTranslations } from 'next-intl';

export default function ForbiddenPage() {
  const t = useTranslations('errors');
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-bg p-6 text-center">
      <h1 className="font-serif text-3xl text-fg">{t('forbiddenTitle')}</h1>
      <p className="text-muted">{t('forbiddenBody')}</p>
    </main>
  );
}
