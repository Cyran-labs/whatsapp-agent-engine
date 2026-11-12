import type { WhatsAppAccountStateView } from '@wabagent/contracts';
import { mentionTone, shownNotRespondingReason } from '@/lib/status-words';
import { NotRespondingMention } from './not-responding-mention';
import { OfflineReason } from './offline-reason';
import { StatusPill } from './status-pill';

/**
 * Pastille de statut et ce qui la suit (spec 6.1, 7.3) : le motif pour un agent IA Offline, la mention « Ne répond
 * pas » quand le moteur l'a calculée : point rouge sur la pastille, motif en bulle (recette 3.4), ou, pour la Whitelist
 * vide, étiquette neutre « Whitelist vide » à côté de la pastille (recette 3.5). Le web ne la recalcule jamais : `notResponding`
 * vient du moteur, nul pour un agent IA Draft, Offline ou de statut inconnu. Valeur brute : un motif inconnu des
 * contrats est écarté par `shownNotRespondingReason`, règle partagée avec le filtre de la liste.
 */
export function AgentStatusLine({
  status,
  statusReason,
  notResponding,
  accountState,
}: {
  status: string;
  statusReason: string | null;
  /** Motif brut reçu du moteur, filtré par `shownNotRespondingReason`. */
  notResponding: string | null;
  accountState: WhatsAppAccountStateView | null;
}) {
  // point d'attention 4 : la mention n'existe que pour Preview et Online, jamais pour un statut inconnu
  const reason = shownNotRespondingReason(status, notResponding);
  const tone = reason === null ? null : mentionTone(reason);
  const mark = reason !== null ? <NotRespondingMention reason={reason} accountState={accountState} variant="mark" /> : null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <StatusPill status={status} mark={tone === 'danger' ? mark : undefined} />
      {status === 'paused' && <OfflineReason raw={statusReason} />}
      {tone === 'neutral' && mark}
    </span>
  );
}
