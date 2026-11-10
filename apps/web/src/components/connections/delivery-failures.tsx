'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { deliveryErrorKey } from '@/lib/whatsapp-display';

interface Props {
  /** Messages sortants refusés par Meta pour ce numéro (`delivery_failures`) ; rien n'est rendu à 0. */
  count: number;
  /** Dernier code d'erreur de Meta (`last_delivery_error_code`), null s'il n'est pas connu. */
  code: number | null;
  /** Lien vers les numéros du compte dans WhatsApp Manager ; null pour un compte sans WABA (CM.com). */
  managerUrl: string | null;
  /** Lien interne vers l'écran où agir (page de l'agent IA : Connexions), sans lien WhatsApp Manager. */
  action?: { href: string; label: string };
}

/**
 * Échecs de remise d'un numéro (audit R-6) : pastille « N échecs de remise », sens du dernier code d'erreur de Meta
 * (« Code Meta N » s'il n'est pas traduit) et lien vers WhatsApp Manager. Partagé par Connexions et l'encart Numéro de
 * la page de l'agent IA.
 */
export function DeliveryFailures({ count, code, managerUrl, action }: Props) {
  const t = useTranslations();
  if (count <= 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="rounded-pill bg-warning-soft px-[9px] py-0.5 text-[11.5px] font-semibold text-warning-ink">
        {t('connections.delivery.failures', { count })}
      </span>
      <span className="text-xs text-muted">{t(deliveryErrorKey(code), { code: code ?? '' })}</span>
      {action && (
        <Link href={action.href} className="text-xs font-semibold text-accent-ink underline">
          {action.label}
        </Link>
      )}
      {managerUrl && (
        <a href={managerUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-accent-ink underline">
          {t('connections.delivery.manager')}
        </a>
      )}
    </div>
  );
}
