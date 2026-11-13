import { useTranslations } from 'next-intl';
import { metaAppUrl } from '@/lib/whatsapp-display';
import { ExternalLink, GuideStep } from './guide-step';

const DOCS_URL = 'https://developers.facebook.com/docs/whatsapp/cloud-api/get-started';
const WHATSAPP_MANAGER_URL = 'https://business.facebook.com/wa/manage/home/';
const BUSINESS_SETTINGS_URL = 'https://business.facebook.com/latest/settings';
// Recette R1 du 13 nov. 2026 : l'étape 2 ouvre les numéros de WhatsApp Manager (là où l'on ajoute un numéro), pas la vue
// d'ensemble. Sans portefeuille connu, Meta ouvre le dernier utilisé : liens précis prévus en R2 (ID du portefeuille saisi).
const PHONE_NUMBERS_URL = 'https://business.facebook.com/wa/manage/phone-numbers/';

/** Conseils du bloc « Recommandé », dans l'ordre de la spec R1 §6.1. */
const RECOMMENDED = ['publish', 'payment', 'verification', 'appSecretProof'] as const;

/**
 * Guide du mode « API Meta directe » (spec R1 §6.1) : cinq étapes obligatoires chez Meta, la saisie (`children`) dans
 * la dernière, puis le bloc « Recommandé ». Aucune étape webhook : WABAGENT inscrit lui-même ses webhooks chez Meta.
 * Les libellés des pages Meta sont dans les messages : ils sont relevés en recette dans les vraies pages.
 */
export function ConnectGuideMeta({ children }: { children: React.ReactNode }) {
  const t = useTranslations('connections.connectFlow.guideMeta');
  return (
    <>
      <ol aria-label={t('label')} className="mt-4 rounded-xl border border-border bg-surface px-4">
        <GuideStep index={1} title={t('app.title')} hint={t('app.hint')}>
          <div className="flex flex-wrap gap-x-4">
            <ExternalLink href={metaAppUrl(null)}>{t('app.link')}</ExternalLink>
            <ExternalLink href={DOCS_URL}>{t('app.docsLink')}</ExternalLink>
          </div>
        </GuideStep>
        <GuideStep index={2} title={t('number.title')} hint={t('number.hint')}>
          <div>
            <ExternalLink href={PHONE_NUMBERS_URL}>{t('number.link')}</ExternalLink>
          </div>
          <div role="note" className="mt-2.5 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning-ink">
            <div className="font-semibold">{t('dedicatedTitle')}</div>
            <p className="mt-0.5">{t('dedicatedText')}</p>
          </div>
        </GuideStep>
        <GuideStep index={3} title={t('token.title')} hint={t('token.hint')}>
          <ExternalLink href={BUSINESS_SETTINGS_URL}>{t('token.link')}</ExternalLink>
        </GuideStep>
        <GuideStep index={4} title={t('waba.title')} hint={t('waba.hint')}>
          <div>
            <ExternalLink href={WHATSAPP_MANAGER_URL}>{t('waba.link')}</ExternalLink>
          </div>
          {/* Piège de la recette du 11 nov. 2026 : une autre valeur de Meta prise pour le WABA ID. */}
          <p className="mt-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning-ink">{t('waba.warning')}</p>
        </GuideStep>
        <GuideStep index={5} title={t('secret.title')} hint={t('secret.hint')}>
          <ExternalLink href={metaAppUrl(null)}>{t('secret.link')}</ExternalLink>
          <div className="mt-3">{children}</div>
        </GuideStep>
      </ol>
      <section className="mt-3 rounded-xl border border-border bg-surface-subtle px-4 py-3 text-[13px] text-fg">
        <h3 className="font-semibold">{t('recommended.title')}</h3>
        <p className="mt-0.5 text-xs text-muted">{t('recommended.hint')}</p>
        <ul aria-label={t('recommended.title')} className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted">
          {RECOMMENDED.map((key) => <li key={key}>{t(`recommended.${key}`)}</li>)}
        </ul>
      </section>
    </>
  );
}
