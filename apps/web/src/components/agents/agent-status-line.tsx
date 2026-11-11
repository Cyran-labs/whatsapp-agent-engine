import { isServingStatus, type WhatsAppAccountStateView } from '@wabagent/contracts';
import { toNotRespondingReason } from '@/lib/status-words';
import { NotRespondingMention } from './not-responding-mention';
import { OfflineReason } from './offline-reason';
import { StatusPill } from './status-pill';

/**
 * Pastille de statut et ce qui la suit (spec 6.1, 7.3) : le motif pour un agent IA Offline, la mention « Ne répond
 * pas » (texte court, motif en bulle) quand le moteur l'a calculée. Le web ne la recalcule jamais : `notResponding`
 * vient du moteur, nul pour un agent IA Draft, Offline ou de statut inconnu. Valeur brute : un motif inconnu des
 * contrats est écarté ici, seule garde des trois lieux (liste, Connexions, colonne).
 */
export function AgentStatusLine({
  status,
  statusReason,
  notResponding,
  accountState,
}: {
  status: string;
  statusReason: string | null;
  /** Motif brut reçu du moteur, filtré par `toNotRespondingReason`. */
  notResponding: string | null;
  accountState: WhatsAppAccountStateView | null;
}) {
  const reason = toNotRespondingReason(notResponding);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <StatusPill status={status} />
      {status === 'paused' && <OfflineReason raw={statusReason} />}
      {/* point d'attention 4 : la mention n'existe que pour Preview et Online, jamais pour un statut inconnu */}
      {isServingStatus(status) && reason !== null && (
        <NotRespondingMention reason={reason} accountState={accountState} variant="short" />
      )}
    </span>
  );
}
