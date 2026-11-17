'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { metaLinks, type MetaLink } from '@wabagent/contracts';
import { cn } from '@/lib/utils';
import { ExternalLink, GuideStep } from './guide-step';

/** Chemin du guide (spec R2a §5.1, point 3 ; maquette 03). */
export type GuidePath = 'existing' | 'scratch';

const DOCS_URL = 'https://developers.facebook.com/docs/whatsapp/cloud-api/get-started';

interface Props {
  /** Vrai tant que le portefeuille de l'étape 1 n'est pas reconnu : la suite est grisée et inactive (maquette 01). */
  locked: boolean;
  path: GuidePath;
  onPathChange: (path: GuidePath) => void;
  /** Portefeuille reconnu à l'étape 1 et WABA lue dans le champ WABA : ils rendent les liens précis (`metaLinks`). */
  businessId: string | null;
  wabaId: string | null;
  /** Saisies du formulaire, posées chacune dans son étape. */
  fields: { waba: React.ReactNode; token: React.ReactNode; secret: React.ReactNode; name: React.ReactNode };
}

/**
 * Choix du chemin et étapes de chaque chemin (spec R2a §5.1, point 3 ; maquette 03), après l'étape du portefeuille.
 * Chemin 1 : la WABA d'abord, l'app ensuite. Chemin 2 : l'app d'abord, puisque c'est elle qui fait naître la WABA. Le
 * jeton, le secret et le nom sont communs. Chaque lien vient de `metaLinks` : un lien `precise: false` garde son texte
 * générique ; le lien des utilisateurs système n'est jamais précis dans ce lot (ruling R-9bis) et ouvre les paramètres
 * du portefeuille, avec le chemin de clics dans l'aide.
 */
export function GuidePaths({ locked, path, onPathChange, businessId, wabaId, fields }: Props) {
  const t = useTranslations('connections.connectFlow.guideMeta');
  const baseId = useId();
  const lockedId = `${baseId}-locked`;
  const links = metaLinks({ business_id: businessId, waba_id: wabaId });

  const linkText = (link: MetaLink, precise: string, generic: string) => (link.precise ? precise : generic);
  const appLinks = (
    <div className="flex flex-wrap gap-x-4">
      <ExternalLink href={links.developerApps.url}>{t('app.link')}</ExternalLink>
      <ExternalLink href={DOCS_URL}>{t('app.docsLink')}</ExternalLink>
    </div>
  );
  const wabaLink = (
    <div>
      <ExternalLink href={links.whatsappAccounts.url}>{linkText(links.whatsappAccounts, t('waba.linkPrecise'), t('waba.link'))}</ExternalLink>
    </div>
  );
  const wabaBody = (
    <>
      {wabaLink}
      {/* Piège de la recette du 11 nov. 2026 : une autre valeur de Meta prise pour le WABA ID. */}
      <p className="mt-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning-ink">{t('waba.warning')}</p>
      <div className="mt-3">{fields.waba}</div>
    </>
  );
  const numberBody = (
    <>
      <div>
        <ExternalLink href={links.phoneNumbers.url}>{linkText(links.phoneNumbers, t('number.linkPrecise'), t('number.link'))}</ExternalLink>
      </div>
      <div role="note" className="mt-2.5 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning-ink">
        <div className="font-semibold">{t('dedicatedTitle')}</div>
        <p className="mt-0.5">{t('dedicatedText')}</p>
      </div>
    </>
  );

  const head =
    path === 'existing'
      ? [
          <GuideStep key="waba" index={2} title={t('waba.title')} hint={t('waba.hint')}>{wabaBody}</GuideStep>,
          <GuideStep key="number" index={3} title={t('number.title')} tag={t('optional')} hint={t('number.hint')}>{numberBody}</GuideStep>,
          <GuideStep key="app" index={4} title={t('app.linkedTitle')} hint={t('app.linkedHint')}>{appLinks}</GuideStep>,
        ]
      : [
          <GuideStep key="app" index={2} title={t('app.title')} hint={t('app.hint')}>{appLinks}</GuideStep>,
          <GuideStep key="waba" index={3} title={t('waba.createdTitle')} hint={t('waba.createdHint')}>{wabaBody}</GuideStep>,
          <GuideStep key="number" index={4} title={t('number.title')} tag={t('optional')} hint={t('number.testHint')}>{numberBody}</GuideStep>,
        ];

  return (
    <>
      {locked && <p id={lockedId} className="mt-3 text-xs text-muted">{t('locked')}</p>}
      {/* `disabled` rend les saisies et le choix inactifs, `inert` les liens : rien d'actif dans la zone grisée. */}
      <fieldset
        disabled={locked}
        inert={locked}
        aria-describedby={locked ? lockedId : undefined}
        className={cn('mt-3 min-w-0 rounded-xl border border-border bg-surface px-4 pb-1 pt-3.5', locked && 'opacity-50')}
      >
        <div role="radiogroup" aria-label={t('paths.label')} className="grid gap-2.5 sm:grid-cols-2">
          <PathCard id={`${baseId}-existing`} checked={path === 'existing'} onSelect={() => onPathChange('existing')} title={t('paths.existing.title')} text={t('paths.existing.text')} />
          <PathCard id={`${baseId}-scratch`} checked={path === 'scratch'} onSelect={() => onPathChange('scratch')} title={t('paths.scratch.title')} text={t('paths.scratch.text')} />
        </div>
        {/* Spec R2a §5.1, point 3 : pas de parcours dans ce lot, ni de page de contact : texte simple, sans faux lien. */}
        <p className="mt-2 text-xs text-muted">{t('otherProvider')}</p>
        <ol aria-label={t('label')} start={2} className="mt-1">
          {head}
          <GuideStep index={5} title={t('token.title')} hint={t('token.hint')}>
            <ExternalLink href={links.systemUsers.url}>{t('token.link')}</ExternalLink>
            <div className="mt-3">{fields.token}</div>
          </GuideStep>
          <GuideStep index={6} title={t('secret.title')} hint={t('secret.hint')}>
            <ExternalLink href={links.developerApps.url}>{t('secret.link')}</ExternalLink>
            <div className="mt-3">{fields.secret}</div>
          </GuideStep>
          <GuideStep index={7} title={t('account.title')} hint={t('account.hint')}>
            <div className="mt-3">{fields.name}</div>
          </GuideStep>
        </ol>
      </fieldset>
    </>
  );
}

/** Carte d'un chemin : bouton radio natif (flèches du clavier), comme les cartes de mode du formulaire. */
function PathCard({ id, checked, onSelect, title, text }: { id: string; checked: boolean; onSelect: () => void; title: string; text: string }) {
  return (
    <label
      className={cn(
        'block cursor-pointer rounded-lg border px-3 py-2.5 text-[13px] hover:bg-surface-subtle',
        checked ? 'border-accent-ink bg-accent-soft' : 'border-border bg-surface',
        'focus-within:ring-2 focus-within:ring-accent-ink',
      )}
    >
      <input
        type="radio"
        name="connect-path"
        className="sr-only"
        checked={checked}
        onChange={onSelect}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-text`}
      />
      <span id={`${id}-title`} className="font-bold text-fg">{title}</span>
      <span id={`${id}-text`} className="mt-0.5 block text-xs text-muted">{text}</span>
    </label>
  );
}
