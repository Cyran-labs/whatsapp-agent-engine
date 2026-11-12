import { useTranslations } from 'next-intl';

/**
 * Logo au-dessus d'une carte centrée : connexion, acceptation d'invitation, mot de passe, page sans organisation.
 * `compact` : carte des messages d'erreur. `brand` faux : sans le logo, quand le rail de gauche le porte déjà (page sans
 * organisation, décision 19-18).
 */
export function AuthCard({ children, compact = false, brand = true }: { children: React.ReactNode; compact?: boolean; brand?: boolean }) {
  const t = useTranslations('common');
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg px-5 py-[30px]">
      {brand && (
        <div className="mb-[18px] flex items-center gap-[9px] text-[15px] font-semibold tracking-[0.4px] text-brand-deep dark:text-fg">
          <span
            className="h-[11px] w-[11px] rounded-full bg-brand-mint shadow-[0_0_0_2px_var(--brand-deep)]"
            aria-hidden="true"
          />
          {t('appName')}
        </div>
      )}
      <div className={`w-full max-w-[384px] rounded-xl border border-border bg-surface shadow-md ${compact ? 'p-[22px]' : 'p-7'}`}>{children}</div>
    </main>
  );
}
