import { useTranslations } from 'next-intl';
import { BOT_STATUSES, type BotStatus } from '@wabagent/contracts';
import { STATUS_STYLE } from './status-style';

/** `unknown` : statut qu'on n'a pas pu lire (lecture de l'agent IA en échec), jamais un statut inventé (audit R-23). */
export const UNKNOWN_STATUS = 'unknown';

function isBotStatus(status: string): status is BotStatus {
  return (BOT_STATUSES as readonly string[]).includes(status);
}

/**
 * Pastille de statut (spec 6.1) : Draft, Preview, Online, Offline, ou « Statut inconnu » ; classes de `STATUS_STYLE`
 * (spec 6.2). Un statut brut inconnu en base est affiché tel quel, en gris (point d'attention 4).
 */
export function StatusPill({ status }: { status: string }) {
  const t = useTranslations('agents.status');
  const style = isBotStatus(status) ? STATUS_STYLE[status] : STATUS_STYLE.paused;
  const label = isBotStatus(status) || status === UNKNOWN_STATUS ? t(status) : status;
  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap rounded-pill px-3 py-1 text-xs font-semibold ${style.pill}`}>
      <span className={`h-[7px] w-[7px] rounded-full ${style.dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}
