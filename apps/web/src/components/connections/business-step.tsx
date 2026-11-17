'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { extractMetaIds, metaLinks } from '@wabagent/contracts';
import { cn } from '@/lib/utils';
import { INPUT, LABEL } from './dialog-ui';
import { ExternalLink, GuideStep } from './guide-step';

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink';
/** Identifiant d'exemple du schéma : une valeur fictive, jamais celle d'un portefeuille réel. */
const SCHEMA_EXAMPLE_ID = '1234567890123456';

interface Props {
  /** Identifiant du champ : le formulaire y ramène le focus sur un refus. */
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Refus posé par le formulaire (portefeuille absent ou non reconnu à l'envoi, refus du moteur sur `business_id`). */
  error: string | null;
}

/**
 * Étape 1 du guide Meta (spec R2a §5.1, point 2 ; maquette 01, variante A) : un seul champ, qui accepte une adresse de
 * page Meta Business ou l'identifiant du portefeuille seul, puis l'aide « Où trouver l'identifiant ? » dépliée, avec le
 * schéma dessiné de la page « Informations sur le portefeuille business ». Contrôle de forme seulement : sans jeton,
 * WABAGENT ne lit rien chez Meta à ce stade, il ne montre donc aucun nom de portefeuille (spec R2a §12).
 */
export function BusinessStep({ id, value, onChange, error }: Props) {
  const t = useTranslations('connections.connectFlow.guideMeta.business');
  const [left, setLeft] = useState(false);
  const ids = extractMetaIds(value);
  const business = ids?.business_id ?? null;
  const waba = business !== null ? ids?.asset_id ?? null : null;
  // Une saisie non reconnue n'est dite qu'à la sortie du champ (pas pendant la frappe) ou par le formulaire à l'envoi ;
  // le refus du formulaire (moteur compris) est toujours dit, le formulaire l'efface à la saisie suivante.
  const shownError = error ?? (business === null && left && value.trim() !== '' ? t('unrecognised') : null);
  const link = metaLinks({ business_id: business, waba_id: null }).businessInfo;
  const describedBy = [`${id}-hint`, business !== null ? `${id}-status` : null, shownError ? `${id}-error` : null].filter(Boolean).join(' ');

  return (
    <ol aria-label={t('title')} className="mt-4 rounded-xl border border-border bg-surface px-4">
      <GuideStep index={1} title={t('title')}>
        <p id={`${id}-hint`} className="mt-0.5 text-xs text-muted">{t('hint')}</p>
        <label htmlFor={id} className={cn(LABEL, 'mt-2.5')}>{t('field')}</label>
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => setLeft(true)}
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder={t('placeholder')}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={describedBy}
          className={cn(INPUT, FOCUS_RING, 'font-mono')}
        />
        {business !== null && (
          <p id={`${id}-status`} role="status" className="mt-2 rounded-lg bg-accent-soft px-2.5 py-1.5 text-[13px] text-accent-ink">
            <span aria-hidden="true">✓ </span>
            {t('recognised', { business })}
            {waba !== null && <> {t('wabaFound', { waba })}</>}
          </p>
        )}
        {shownError && <p id={`${id}-error`} className="mt-1 text-[12px] text-danger">{shownError}</p>}
        <details open className="mt-2.5 text-[13px]">
          <summary className={cn('cursor-pointer font-semibold text-accent-ink', FOCUS_RING)}>{t('help')}</summary>
          <p className="mt-1.5 text-xs text-muted">{t('helpPath')}</p>
          <BusinessInfoSchema />
          <ExternalLink href={link.url}>{link.precise ? t('linkPrecise') : t('link')}</ExternalLink>
        </details>
      </GuideStep>
    </ol>
  );
}

/**
 * Schéma dessiné de la page « Informations sur le portefeuille business » de Meta (maquette 01) : pas une capture, qui
 * vieillirait à chaque changement de Meta ; il montre où lire l'identifiant. Les libellés de Meta sont relevés en recette.
 */
function BusinessInfoSchema() {
  const t = useTranslations('connections.connectFlow.guideMeta.business.schema');
  return (
    <figure aria-label={t('label')} className="mt-2 rounded-lg border border-border bg-surface-subtle p-2.5 text-xs text-fg">
      <div className="mb-1.5 font-bold">{t('title')}</div>
      <dl>
        <div className="flex justify-between gap-3 border-t border-border py-1">
          <dt>{t('name')}</dt>
          <dd className="text-muted">{t('nameExample')}</dd>
        </div>
        <div className="flex justify-between gap-3 border-t border-border py-1">
          <dt>{t('id')}</dt>
          <dd className="rounded-sm bg-warning-soft px-1 font-mono text-warning-ink ring-2 ring-warning">{SCHEMA_EXAMPLE_ID}</dd>
        </div>
      </dl>
    </figure>
  );
}
