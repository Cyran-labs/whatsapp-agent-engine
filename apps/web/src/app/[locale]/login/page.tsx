import { getTranslations } from 'next-intl/server';
import { AuthCard } from '@/components/auth/auth-card';
import { LoginForm } from '@/components/auth/login-form';
import { routing } from '@/i18n/routing';
import { safeNext, splitLocale } from '@/lib/safe-next';

type Param = string | string[] | undefined;

/** Valeur d'un paramètre d'adresse : une seule occurrence, sinon rien (jamais de tableau). */
function single(value: Param): string | null {
  return typeof value === 'string' ? value : null;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: Param; reason?: Param; next?: Param }>;
}) {
  const t = await getTranslations('auth');
  const { reset, reason, next } = await searchParams;
  // Retour là où l'on était après une session expirée (audit R-10) : chemin interne seulement, sinon l'accueil.
  const target = safeNext(single(next));
  const redirectTo = target ? splitLocale(target, routing.locales) : undefined;
  return (
    <AuthCard>
      <h1 className="mb-[18px] font-serif text-[22px] font-normal leading-[1.2] text-fg">{t('loginTitle')}</h1>
      {single(reset) === '1' && (
        <div role="status" className="mb-3.5 rounded-lg border border-[#BBE7C8] bg-success-soft px-[13px] py-[11px] text-[13px] text-success-ink">
          {t('reset.done')}
        </div>
      )}
      {single(reset) !== '1' && single(reason) === 'session' && (
        <div role="status" className="mb-3.5 rounded-lg border border-warning bg-warning-soft px-[13px] py-[11px] text-[13px] text-warning-ink">
          {t('sessionExpired')}
        </div>
      )}
      <LoginForm forgotHref="/forgot-password" redirectTo={redirectTo} />
    </AuthCard>
  );
}
