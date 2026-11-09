'use client';

import { useTranslations } from 'next-intl';

/** Préfixe que le moteur met devant le message brut de Meta (Graph, en anglais) dans le texte d'un échec. */
const META_RAW_PREFIX = 'Meta : ';

/** Texte brut de Meta contenu dans un motif ou un détail de contrôle du moteur, null si ce motif n'en contient pas. */
export function rawMetaText(detail: string | null | undefined): string | null {
  if (!detail?.startsWith(META_RAW_PREFIX)) return null;
  const raw = detail.slice(META_RAW_PREFIX.length).trim();
  return raw.length > 0 ? raw : null;
}

/** Texte brut du fournisseur (audit R-21) : replié, la phrase traduite qui le précède dit l'essentiel. */
export function ProviderTextDetail({ text }: { text: string }) {
  const t = useTranslations('connections');
  return (
    <details className="mt-1 text-[12px]">
      <summary className="cursor-pointer font-semibold underline">{t('providerText')}</summary>
      <p className="mt-1 break-words font-mono text-[11.5px]">{text}</p>
    </details>
  );
}
