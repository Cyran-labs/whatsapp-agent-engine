import { useTranslations } from 'next-intl';

export default function Home() {
  const t = useTranslations('common');
  return <main className="p-8 font-serif text-2xl text-fg">{t('appName')}</main>;
}
