'use client';

import { useTranslations } from 'next-intl';

interface Props {
  /** Intitulé du détail : « Texte renvoyé par le fournisseur » ou « Détail de WABAGENT (en français) ». */
  summary: string;
  text: string;
}

/**
 * Texte replié sous une phrase traduite (audit R-21) : le message du fournisseur tel qu'il l'a écrit
 * (`provider_text` du moteur), ou, en anglais, le motif du moteur qui est en français. Jamais déduit d'un autre texte.
 */
export function TextDetail({ summary, text }: Props) {
  return (
    <details className="mt-1 text-[12px]">
      <summary className="cursor-pointer font-semibold underline">{summary}</summary>
      <p className="mt-1 break-words font-mono text-[11.5px]">{text}</p>
    </details>
  );
}

/** Texte brut du fournisseur (`provider_text`), replié. */
export function ProviderTextDetail({ text }: { text: string }) {
  const t = useTranslations('connections');
  return <TextDetail summary={t('providerText')} text={text} />;
}
