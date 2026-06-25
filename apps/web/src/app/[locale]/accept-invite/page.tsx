import { useTranslations } from 'next-intl';
import { AcceptInviteForm } from '@/components/auth/accept-invite-form';

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <AcceptInviteContent token={token ?? ''} />;
}

function AcceptInviteContent({ token }: { token: string }) {
  const t = useTranslations('auth');
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg p-6">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 shadow-sm">
        <h1 className="mb-6 font-serif text-2xl text-fg">{t('acceptInviteTitle')}</h1>
        {token ? (
          <AcceptInviteForm token={token} />
        ) : (
          <p className="text-sm text-danger">{t('invalidInvite')}</p>
        )}
      </div>
    </main>
  );
}
