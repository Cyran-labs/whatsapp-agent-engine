import { isServingStatus, type NotRespondingReason, type WhatsAppAccountStateView } from '@wabagent/contracts';
import { NotRespondingMention } from './not-responding-mention';
import { OfflineReason } from './offline-reason';
import { StatusPill } from './status-pill';

/**
 * Pastille de statut et ce qui la suit (spec 6.1, 7.3) : le motif pour un agent IA Offline, la mention « Ne répond
 * pas » (texte court, motif en bulle) quand le moteur l'a calculée. Le web ne la recalcule jamais : `notResponding`
 * vient du moteur, nul pour un agent IA Draft, Offline ou de statut inconnu.
 */
export function AgentStatusLine({
  status,
  statusReason,
  notResponding,
  accountState,
}: {
  status: string;
  statusReason: string | null;
  notResponding: NotRespondingReason | null;
  accountState: WhatsAppAccountStateView | null;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <StatusPill status={status} />
      {status === 'paused' && <OfflineReason raw={statusReason} />}
      {/* point d'attention 4 : la mention n'existe que pour Preview et Online, jamais pour un statut inconnu */}
      {isServingStatus(status) && notResponding !== null && (
        <NotRespondingMention reason={notResponding} accountState={accountState} variant="short" />
      )}
    </span>
  );
}
