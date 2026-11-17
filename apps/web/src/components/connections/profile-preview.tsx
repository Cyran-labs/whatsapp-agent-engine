'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { isVertical, sitesOf, type ProfileDraft } from './profile-draft';

interface Props {
  /** Nom affiché aux contacts (`WhatsAppNumberView.display_name`), jamais un nom seulement demandé ou approuvé. */
  displayName: string;
  draft: ProfileDraft;
  /** Adresse de la photo relue chez Meta, null sans photo. */
  photoUrl: string | null;
}

/** Photo du profil servie par Meta : seulement une adresse https, jamais une autre forme. */
export function safePhotoUrl(url: string | null): string | null {
  return url !== null && url.startsWith('https://') ? url : null;
}

/** Pastille du profil : la photo relue, sinon l'initiale du nom affiché. */
export function ProfileAvatar({ name, photoUrl, size }: { name: string; photoUrl: string | null; size: 'md' | 'lg' }) {
  const t = useTranslations('connections.profile');
  const box = size === 'lg' ? 'h-[70px] w-[70px] text-[20px]' : 'h-[54px] w-[54px] text-[17px]';
  const url = safePhotoUrl(photoUrl);
  if (url !== null) {
    return <img src={url} alt={t('photoAlt')} className={`${box} shrink-0 rounded-full border border-border object-cover`} />;
  }
  return (
    <span aria-hidden="true" className={`${box} flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-bold text-accent-ink`}>
      {[...name.trim()][0]?.toUpperCase() ?? '?'}
    </span>
  );
}

function Block({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="mt-2 rounded-lg bg-surface px-2.5 py-2 text-[12.5px] text-fg">
      {label && <div className="text-[10.5px] text-muted">{label}</div>}
      <div className="break-words">{children}</div>
    </div>
  );
}

/**
 * Aperçu indicatif de la fiche de l'entreprise telle que le contact l'ouvre dans WhatsApp (spec R2a §5.2, point 4) : il
 * suit la saisie, avant tout enregistrement. Le rendu exact dépend de l'application du contact, l'aperçu le dit.
 */
export function ProfilePreview({ displayName, draft, photoUrl }: Props) {
  const t = useTranslations('connections.profile');
  const tv = useTranslations('connections.profile.verticals');
  const titleId = useId();
  const sites = sitesOf(draft);
  const description = draft.description.trim();
  const address = draft.address.trim();
  const email = draft.email.trim();
  return (
    <section aria-labelledby={titleId} className="min-w-0">
      <h5 id={titleId} className="mb-2 text-[12.5px] font-semibold text-muted">{t('preview.title')}</h5>
      <div className="rounded-2xl border border-border bg-bg p-3.5">
        <div className="flex flex-col items-center text-center">
          <ProfileAvatar name={displayName} photoUrl={photoUrl} size="lg" />
          <b className="mt-1.5 text-[15px]">{displayName}</b>
          <div className="text-[10.5px] text-muted">{t('preview.business')}</div>
          {draft.about.trim() !== '' && <div className="mt-1 break-words text-[12.5px]">{draft.about.trim()}</div>}
        </div>
        {description !== '' && <Block>{description}</Block>}
        {isVertical(draft.vertical) && <Block label={t('preview.vertical')}>{tv(draft.vertical)}</Block>}
        {address !== '' && <Block label={t('preview.address')}>{address}</Block>}
        {email !== '' && <Block label={t('preview.email')}>{email}</Block>}
        {sites.map((site, index) => (
          <Block key={index} label={t('preview.website')}>{site}</Block>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-muted">{t('preview.note')}</p>
    </section>
  );
}
