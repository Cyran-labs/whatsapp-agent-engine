import { useTranslations } from 'next-intl';
import type { WhatsAppInventorySummary } from '@wabagent/contracts';

/**
 * Bilan d'un inventaire en clair. Un numéro refusé n'est compté que par `refused`, sans autre détail
 * (le refus est neutre : il ne dit pas qui tient le numéro).
 */
export function InventorySummary({ inventory }: { inventory: WhatsAppInventorySummary }) {
  const t = useTranslations('connections.inventory');
  return (
    <div className="mt-3 text-[13px]">
      <p className="font-semibold">{t('summary', { added: inventory.added, removed: inventory.removed })}</p>
      {inventory.refused > 0 && <p className="mt-0.5 text-warning-ink">{t('refused', { count: inventory.refused })}</p>}
    </div>
  );
}
