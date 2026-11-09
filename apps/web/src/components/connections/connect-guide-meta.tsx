import { useTranslations } from 'next-intl';
import { metaAppUrl } from '@/lib/whatsapp-display';
import { ExternalLink, GuideStep } from './guide-step';

const DOCS_URL = 'https://developers.facebook.com/docs/whatsapp/cloud-api/get-started';
const WHATSAPP_MANAGER_URL = 'https://business.facebook.com/wa/manage/home/';
const BUSINESS_SETTINGS_URL = 'https://business.facebook.com/latest/settings';

/** Guide du mode « API Meta directe » : trois étapes chez Meta, puis la saisie (`children`) dans la dernière. */
export function ConnectGuideMeta({ children }: { children: React.ReactNode }) {
  const t = useTranslations('connections.connectFlow.guideMeta');
  return (
    <ol aria-label={t('label')} className="mt-4 rounded-xl border border-border bg-surface px-4">
      <GuideStep index={1} title={t('app.title')} hint={t('app.hint')}>
        <ExternalLink href={DOCS_URL}>{t('app.link')}</ExternalLink>
      </GuideStep>
      <GuideStep index={2} title={t('number.title')} hint={t('number.hint')}>
        <div>
          <ExternalLink href={WHATSAPP_MANAGER_URL}>{t('number.link')}</ExternalLink>
        </div>
        <div role="note" className="mt-2.5 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning-ink">
          <div className="font-semibold">{t('dedicatedTitle')}</div>
          <p className="mt-0.5">{t('dedicatedText')}</p>
        </div>
      </GuideStep>
      <GuideStep index={3} title={t('token.title')} hint={t('token.hint')}>
        <div className="flex flex-wrap gap-x-4">
          <ExternalLink href={BUSINESS_SETTINGS_URL}>{t('token.link')}</ExternalLink>
          <ExternalLink href={metaAppUrl(null)}>{t('token.appsLink')}</ExternalLink>
        </div>
        <div className="mt-3">{children}</div>
      </GuideStep>
    </ol>
  );
}
