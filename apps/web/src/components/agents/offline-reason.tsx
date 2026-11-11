import { useTranslations } from 'next-intl';
import { offlineReasonKey } from '@/lib/status-words';

/**
 * Motif d'Offline, à côté de la pastille (spec 6.1) : l'appelant ne le rend que pour un agent IA `paused`. Un motif
 * inconnu se dit « Arrêté », jamais par son code brut.
 */
export function OfflineReason({ raw }: { raw: string | null | undefined }) {
  const t = useTranslations('agentStatus.pauseReasons');
  return <span className="text-[12.5px] text-muted-2">{t(offlineReasonKey(raw))}</span>;
}
