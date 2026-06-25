import { useTranslations } from 'next-intl';

export default function FirstRunPage() {
  const t = useTranslations('firstRun');
  return (
    <section className="mx-auto max-w-2xl rounded-xl border border-border bg-surface p-8">
      <h1 className="font-serif text-3xl text-fg">{t('welcome')}</h1>
      <p className="mt-2 text-muted">{t('subtitle')}</p>
    </section>
  );
}
