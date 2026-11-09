import { useTranslations } from 'next-intl';
import { ExternalLink, GuideStep } from './guide-step';

const CM_DOCS_URL = 'https://developers.cm.com/messaging/docs/channels-authentication';

/** Guide du mode CM.com : où trouver l'identifiant du compte et le productToken, puis la saisie (`children`). */
export function ConnectGuideCm({ children }: { children: React.ReactNode }) {
  const t = useTranslations('connections.connectFlow.guideCm');
  return (
    <ol aria-label={t('label')} className="mt-4 rounded-xl border border-border bg-surface px-4">
      <GuideStep index={1} title={t('account.title')} hint={t('account.hint')} />
      <GuideStep index={2} title={t('token.title')} hint={t('token.hint')}>
        <ExternalLink href={CM_DOCS_URL}>{t('token.link')}</ExternalLink>
        <div className="mt-3">{children}</div>
      </GuideStep>
    </ol>
  );
}
